// Agent Advanced Routes - Multi-Agent, Model Failover, OpenAI-Compatible API
// Enterprise features for advanced OpenClaw configuration

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { validateObjectId } from '../../validation/schemas.js';
import { multiAgentService } from '../../services/multi-agent.service.js';
import { modelFailoverService, AVAILABLE_MODELS } from '../../services/model-failover.service.js';
import { webhookService } from '../../services/webhook.service.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';
import { PLAN_LIMITS } from '@openclaw-business/shared';
import type { PlanId } from '@openclaw-business/shared';

export async function agentAdvancedRoutes(fastify: FastifyInstance) {
  // ── Trial guard: block mutations when trial has expired ──────────
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }
  });

  // ── Multi-Agent Routes ──────────────────────────────────────

  // GET /api/agents/:id/sub-agents - List sub-agents
  fastify.get<{ Params: { id: string } }>('/:id/sub-agents', {
    schema: {
      tags: ['Sub-Agents'],
      summary: 'List sub-agents',
      description: 'List all sub-agents configured for a parent agent in a multi-agent setup.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ subAgents: z.array(z.any()) }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const subAgents = await multiAgentService.listSubAgents(agentId, request.userId);
    return { subAgents };
  });

  // POST /api/agents/:id/sub-agents - Add sub-agent
  fastify.post<{
    Params: { id: string };
    Body: { name: string; isDefault?: boolean; bindings?: any[] };
  }>('/:id/sub-agents', {
    schema: {
      tags: ['Sub-Agents'],
      summary: 'Add a sub-agent',
      description: 'Add a new sub-agent to a parent agent. Sub-agents can have their own bindings and act as specialized workers.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        name: z.string().describe('Sub-agent name'),
        isDefault: z.boolean().optional().describe('Whether this sub-agent is the default'),
        bindings: z.array(z.any()).optional().describe('Channel/routing bindings'),
      }),
      response: {
        201: z.object({ subAgent: z.any() }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { name, isDefault, bindings } = request.body;
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }

    // Multi-agent routing is Enterprise-only
    const org = await getDatabase().collection('organizations').findOne({ clerkId: request.organizationId });
    if (org?.subscription?.plan !== 'enterprise') {
      return reply.code(403).send({ error: 'Multi-agent routing requires an Enterprise plan. Upgrade to add multiple agents per workspace.' });
    }

    try {
      const subAgent = await multiAgentService.addSubAgent(agentId, request.userId, {
        name,
        isDefault,
        bindings,
      });
      return reply.code(201).send({ subAgent });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add sub-agent';
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/agents/:id/sub-agents/:subId - Remove sub-agent
  fastify.delete<{ Params: { id: string; subId: string } }>(
    '/:id/sub-agents/:subId',
    {
      schema: {
        tags: ['Sub-Agents'],
        summary: 'Remove a sub-agent',
        description: 'Remove a sub-agent from a parent agent\'s multi-agent configuration.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          subId: z.string().describe('Sub-agent ID'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        await multiAgentService.removeSubAgent(agentId, request.userId, request.params.subId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove sub-agent';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // PATCH /api/agents/:id/sub-agents/:subId/bindings - Update bindings
  fastify.patch<{
    Params: { id: string; subId: string };
    Body: { bindings: any[] };
  }>('/:id/sub-agents/:subId/bindings', {
    schema: {
      tags: ['Sub-Agents'],
      summary: 'Update sub-agent bindings',
      description: 'Update the channel/routing bindings for a specific sub-agent, controlling which messages are routed to it.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        subId: z.string().describe('Sub-agent ID'),
      }),
      body: z.object({
        bindings: z.array(z.any()).describe('Channel/routing bindings'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await multiAgentService.updateBindings(
        agentId,
        request.userId,
        request.params.subId,
        request.body.bindings
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update bindings';
      return reply.code(400).send({ error: message });
    }
  });

  // PATCH /api/agents/:id/sub-agents/:subId/overrides - Update per-agent overrides
  fastify.patch<{
    Params: { id: string; subId: string };
    Body: {
      model?: string;
      toolProfile?: string;
      toolAllow?: string[];
      toolDeny?: string[];
      sandboxMode?: string;
      heartbeatEnabled?: boolean;
      heartbeatInterval?: string;
      identityName?: string;
      identityAvatar?: string;
    };
  }>('/:id/sub-agents/:subId/overrides', {
    schema: {
      tags: ['Sub-Agents'],
      summary: 'Update sub-agent overrides',
      description: 'Update per-agent configuration overrides for a sub-agent, including model, tool policy, sandbox, heartbeat, and identity settings.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        subId: z.string().describe('Sub-agent ID'),
      }),
      body: z.object({
        model: z.string().optional().describe('Model override'),
        toolProfile: z.string().optional().describe('Tool profile name'),
        toolAllow: z.array(z.string()).optional().describe('Allowed tools'),
        toolDeny: z.array(z.string()).optional().describe('Denied tools'),
        sandboxMode: z.string().optional().describe('Sandbox mode override'),
        heartbeatEnabled: z.boolean().optional().describe('Enable/disable heartbeat'),
        heartbeatInterval: z.string().optional().describe('Heartbeat interval'),
        identityName: z.string().optional().describe('Sub-agent display name'),
        identityAvatar: z.string().optional().describe('Sub-agent avatar URL'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await multiAgentService.updateOverrides(
        agentId,
        request.userId,
        request.params.subId,
        request.body
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update overrides';
      return reply.code(400).send({ error: message });
    }
  });

  // ── Model Failover Routes ──────────────────────────────────

  // GET /api/agents/:id/models - Get model configuration
  fastify.get<{ Params: { id: string } }>('/:id/models', {
    schema: {
      tags: ['Agents'],
      summary: 'Get model configuration',
      description: 'Retrieve the model configuration for an agent, including primary model, fallback chain, provider settings, and available models.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({
          config: z.object({
            primaryModel: z.string(),
            fallbackModels: z.array(z.string()),
            modelAllowlist: z.record(z.any()),
            providers: z.record(z.any()),
            openaiCompatEnabled: z.boolean(),
          }),
          availableModels: z.array(z.any()),
        }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const config = await modelFailoverService.getModelConfig(agentId, request.userId);
    return {
      config: config || {
        primaryModel: null,
        fallbackModels: [],
        modelAllowlist: {},
        providers: {},
        openaiCompatEnabled: false,
      },
      availableModels: AVAILABLE_MODELS,
    };
  });

  // PATCH /api/agents/:id/models - Update model configuration
  fastify.patch<{
    Params: { id: string };
    Body: {
      primaryModel?: string;
      fallbackModels?: string[];
      addModel?: { id: string; alias?: string };
      removeModel?: string;
      setProvider?: { name: string; apiKey?: string; baseUrl?: string };
      removeProvider?: string;
      openaiCompatEnabled?: boolean;
    };
  }>('/:id/models', {
    schema: {
      tags: ['Agents'],
      summary: 'Update model configuration',
      description: 'Update an agent\'s model configuration including primary model, fallback chain, model allowlist, provider credentials, and OpenAI-compatible API toggle.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        primaryModel: z.string().optional().describe('Primary model identifier'),
        fallbackModels: z.array(z.string()).optional().describe('Ordered fallback model list'),
        addModel: z.record(z.any()).optional().describe('Add a model to the allowlist'),
        removeModel: z.string().optional().describe('Remove a model from the allowlist'),
        setProvider: z.record(z.any()).optional().describe('Add or update a provider'),
        removeProvider: z.string().optional().describe('Remove a provider'),
        openaiCompatEnabled: z.boolean().optional().describe('Toggle OpenAI-compatible API endpoint'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await modelFailoverService.updateModelConfig(agentId, request.userId, request.body);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update model config';
      return reply.code(400).send({ error: message });
    }
  });

  // ── Webhook Routes ─────────────────────────────────────────
  const agentsCollection = () => getDatabase().collection('agents');

  async function assertAgentOwnership(agentId: string, request: { userId?: string; organizationId?: string }): Promise<boolean> {
    const filter: any = { _id: new ObjectId(agentId) };
    if (request.organizationId) filter.organizationId = request.organizationId;
    else filter.userId = request.userId;
    const agent = await agentsCollection().findOne(filter);
    return !!agent;
  }

  // GET /api/agents/:id/webhooks - List webhooks
  fastify.get<{ Params: { id: string } }>('/:id/webhooks', {
    schema: {
      tags: ['Agents'],
      summary: 'List webhooks',
      description: 'List all webhook endpoints configured for an agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ webhooks: z.array(z.any()) }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    if (!(await assertAgentOwnership(agentId, request))) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const webhooks = await webhookService.getWebhooks(agentId, request.userId!, request.organizationId);
    return { webhooks };
  });

  // POST /api/agents/:id/webhooks - Create webhook
  fastify.post<{
    Params: { id: string };
    Body: { name: string };
  }>('/:id/webhooks', {
    schema: {
      tags: ['Agents'],
      summary: 'Create a webhook',
      description: 'Create a new webhook endpoint for an agent. The webhook URL and token are auto-generated.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        name: z.string().describe('Webhook name'),
      }),
      response: {
        201: z.object({ webhook: z.any() }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    if (!(await assertAgentOwnership(agentId, request))) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const plan = (request.plan || 'unpaid') as PlanId;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;
    if (limits.webhooksPerAgent === 0) {
      return reply.code(403).send({
        error: 'Webhooks not available',
        message: `Your ${plan} plan does not include webhooks. Upgrade to Professional to create webhook endpoints.`,
      });
    }

    const existing = await webhookService.getWebhooks(agentId, request.userId!, request.organizationId);
    if (existing.length >= limits.webhooksPerAgent) {
      return reply.code(403).send({
        error: 'Webhook limit reached',
        message: `Your plan allows ${limits.webhooksPerAgent} webhooks per agent.`,
        used: existing.length,
        limit: limits.webhooksPerAgent,
      });
    }

    const { name } = request.body;
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }

    try {
      const webhook = await webhookService.createWebhook(agentId, request.userId, { name });
      return reply.code(201).send({ webhook });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create webhook';
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/agents/:id/webhooks/:name - Delete webhook
  fastify.delete<{ Params: { id: string; name: string } }>(
    '/:id/webhooks/:name',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Delete a webhook',
        description: 'Delete a webhook endpoint from an agent by its name.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          name: z.string().describe('Webhook name'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      if (!(await assertAgentOwnership(agentId, request))) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      try {
        await webhookService.deleteWebhook(agentId, request.userId!, request.params.name, request.organizationId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete webhook';
        return reply.code(400).send({ error: message });
      }
    }
  );
}
