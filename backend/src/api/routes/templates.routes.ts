import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import type { Template, CreateTemplateRequest, DeployFromTemplateRequest } from '@openclaw-business/shared';
import { validateObjectId } from '../../validation/schemas.js';
import { deploymentService } from '../../services/deployment.service.js';
import { serializeDoc } from '../../utils/sanitize.js';
import { z } from 'zod';
import { PLAN_LIMITS, type PlanId } from '@openclaw-business/shared';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  templateResponseSchema,
  listTemplatesResponseSchema,
} from '../../validation/response-schemas.js';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.enum(['sales', 'support', 'marketing', 'operations', 'finance']),
  icon: z.string().min(1),
  config: z.object({
    model: z.string(),
    prompts: z.object({
      system: z.string(),
      agents: z.string().optional(),
      soul: z.string().optional(),
    }),
    tools: z.object({
      profile: z.enum(['minimal', 'coding', 'messaging', 'full']),
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }),
    skills: z.array(z.string()),
    channels: z.array(z.string()).optional(),
  }),
  channels: z.array(z.string()),
  features: z.array(z.string()).optional(),
  integrations: z.array(z.string()).optional(),
  pricing: z.object({
    setup: z.number().min(0),
    monthly: z.number().min(0),
    perOutcome: z.number().min(0).optional(),
    outcomeLabel: z.string().optional(),
  }),
  isPublic: z.boolean().optional(),
});

export async function templatesRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const templatesCollection = db.collection<Template>('templates');
  const agentsCollection = db.collection('agents');

  // GET /api/templates - List templates
  fastify.get('/', {
    schema: {
      tags: ['Templates'],
      summary: 'List templates',
      description: 'Returns a paginated list of public templates, optionally filtered by category or search term.',
      querystring: z.object({
        category: z.string().optional().describe('Filter by template category'),
        search: z.string().optional().describe('Search term for name or description'),
        limit: z.number().optional().describe('Max results to return (default 50)'),
        offset: z.number().optional().describe('Number of results to skip (default 0)'),
      }),
      response: {
        200: z.object({
          templates: z.array(templateResponseSchema),
          total: z.number(),
        }),
      },
    },
  }, async (request, reply) => {
    const { category, search, limit = 50, offset = 0 } = request.query as any;

    const filter: any = { isPublic: true };
    if (category) filter.category = category;
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }

    const templates = await templatesCollection
      .find(filter)
      .sort({ popularity: -1, createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(offset))
      .toArray();

    const total = await templatesCollection.countDocuments(filter);

    return { templates: templates.map(serializeDoc), total };
  });

  // GET /api/templates/:id - Get template detail
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Get template by ID',
      description: 'Returns the full details of a specific template.',
      params: z.object({
        id: z.string().describe('Template ID'),
      }),
      response: {
        200: z.object({
          template: templateResponseSchema,
        }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid template ID format' });
    }

    const template = await templatesCollection.findOne({
      _id: new ObjectId(request.params.id) as any,
    });

    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    return { template: serializeDoc(template) };
  });

  // POST /api/templates - Create template
  fastify.post<{ Body: CreateTemplateRequest }>('/', {
    schema: {
      tags: ['Templates'],
      summary: 'Create a new template',
      description: 'Creates a new agent template with the specified configuration, pricing, and channel setup.',
      body: createTemplateSchema,
      response: {
        201: z.object({
          template: templateResponseSchema,
        }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;

    const validation = createTemplateSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Validation failed', details: validation.error.errors });
    }

    const data = validation.data;

    const template: Template = {
      name: data.name,
      description: data.description,
      category: data.category,
      icon: data.icon,
      config: data.config as any,
      channels: data.channels,
      features: data.features || [],
      integrations: data.integrations || [],
      pricing: data.pricing,
      popularity: 0,
      isPublic: data.isPublic ?? true,
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await templatesCollection.insertOne(template as any);

    return reply.code(201).send({ template: serializeDoc({ ...template, _id: result.insertedId.toString() }) });
  });

  // POST /api/templates/:id/deploy - Deploy agent from template
  fastify.post<{ Params: { id: string }; Body: DeployFromTemplateRequest }>('/:id/deploy', {
    schema: {
      tags: ['Templates'],
      summary: 'Deploy agent from template',
      description: 'Creates and deploys a new agent based on the specified template. The deployment runs asynchronously; the agent is returned immediately with status "deploying".',
      params: z.object({
        id: z.string().describe('Template ID'),
      }),
      body: z.object({
        name: z.string().optional().describe('Custom agent name (defaults to template name)'),
        channels: z.array(z.string()).optional().describe('Channels to enable (defaults to template channels)'),
        systemPromptOverride: z.string().optional().describe('Override the template system prompt'),
      }),
      response: {
        201: z.object({
          agent: z.object({
            _id: z.string(),
            name: z.string(),
            status: z.string(),
            templateId: z.string(),
          }).passthrough(),
        }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Trial guard: block deploy when trial expired
    if (request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }

    // Plan limit: check agent count
    const plan = (request.plan || 'unpaid') as PlanId;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;
    const ownerFilter: any = organizationId ? { organizationId } : { userId };
    const agentCount = await agentsCollection.countDocuments(ownerFilter);
    if (limits.agents !== -1 && agentCount >= limits.agents) {
      return reply.code(403).send({ error: `Agent limit reached (${limits.agents}). Please upgrade your plan.` });
    }

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid template ID format' });
    }

    const template = await templatesCollection.findOne({
      _id: new ObjectId(request.params.id) as any,
    });

    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    const body = request.body || {};

    const agent = {
      userId,
      organizationId,
      name: body.name || template.name,
      description: template.description,
      useCase: template.category,
      status: 'deploying',
      deploymentType: 'managed',
      templateId: request.params.id,
      config: {
        model: template.config.model,
        systemPrompt: body.systemPromptOverride || template.config.prompts.system,
        skills: template.config.skills,
        tools: template.config.tools.allow || ['sessions_send'],
      },
      channels: (body.channels || template.channels).map((type: string) => ({
        type,
        status: 'pending',
      })),
      metrics: {
        totalMessages: 0,
        totalCost: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await agentsCollection.insertOne(agent as any);
    const agentId = result.insertedId.toString();

    // Increment template popularity
    await templatesCollection.updateOne(
      { _id: new ObjectId(request.params.id) } as any,
      { $inc: { popularity: 1 } }
    );

    // Deploy the agent container asynchronously
    (async () => {
      try {
        const deployment = await deploymentService.deployAgent({
          agentId,
          name: agent.name,
          description: template.description,
          model: agent.config.model,
          systemPrompt: agent.config.systemPrompt,
          skills: agent.config.skills,
          channels: (body.channels || template.channels).map((type: string) => ({ type: type as any })),
        } as any);

        await agentsCollection.updateOne(
          { _id: result.insertedId },
          {
            $set: {
              status: 'running',
              containerId: deployment.containerId,
              internalPort: deployment.gatewayPort,
              gatewayUrl: deployment.gatewayUrl,
              gatewayToken: deployment.gatewayToken,
              updatedAt: new Date(),
            },
          }
        );
      } catch (error) {
        await agentsCollection.updateOne(
          { _id: result.insertedId },
          {
            $set: {
              status: 'error',
              errorMessage: error instanceof Error ? error.message : 'Deployment failed',
              updatedAt: new Date(),
            },
          }
        );
      }
    })();

    return reply.code(201).send({ agent: serializeDoc({ ...agent, _id: agentId }) });
  });

  // DELETE /api/templates/:id - Delete template
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Templates'],
      summary: 'Delete a template',
      description: 'Permanently deletes a template. Only the creator can delete their own templates.',
      params: z.object({
        id: z.string().describe('Template ID'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid template ID format' });
    }

    const result = await templatesCollection.deleteOne({
      _id: new ObjectId(request.params.id) as any,
      createdBy: userId,
    });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'Template not found or not owned by you' });
    }

    return { success: true };
  });
}
