import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { deploymentService } from '../../services/deployment.service.js';
import { workspaceService } from '../../services/workspace.service.js';
import { config } from '../../config/env.js';
import type { Agent, CreateAgentRequest } from '@openclaw-business/shared';
import { PLAN_LIMITS, type PlanId } from '@openclaw-business/shared';
import { createAgentSchema, architectConfigSchema, validateObjectId } from '../../validation/schemas.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { serializeAgent, serializeAgents } from '../../utils/sanitize.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { syncAgentQuantity } from '../../services/billing-sync.service.js';
import { gatewayManager } from '../../services/gateway-ws.service.js';

/** Parse duration string like "5m", "2h", "30s" to milliseconds */
function parseDuration(s: string): number {
  const m = s.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return 30 * 60_000; // default 30m
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case 's': return n * 1000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: return n * 60_000;
  }
}
import { decrypt, encrypt } from '../../utils/encryption.js';
import { clawHubService } from '../../services/clawhub.service.js';
import {
  listAgentsResponseSchema,
  getAgentResponseSchema,
  createAgentResponseSchema,
  successResponseSchema,
  errorResponseSchema,
  validationErrorSchema,
  planLimitErrorSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';

// ── Zod Schemas ──────────────────────────────────────────────────
const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  config: z.record(z.unknown()).optional(),
}).strict(); // Reject unknown keys

export async function agentRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const agentsCollection = db.collection<Agent>('agents');

  // GET /api/agents - List all agents
  fastify.get('/', {
    schema: {
      tags: ['Agents'],
      summary: 'List all agents',
      description: 'Returns all agents owned by the current user or organization.',
      response: { 200: listAgentsResponseSchema },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Filter by organization if user is in one, otherwise by userId
    const filter = organizationId ? { organizationId } : { userId };

    const agents = await agentsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Return immediately; run recovery in background (avoids blocking response)
    const deployingAgents = agents.filter(a => a.status === 'deploying');
    if (deployingAgents.length > 0) {
      setImmediate(async () => {
        for (const agent of deployingAgents) {
          try {
            const agentId = agent._id.toString();
            if (agent.containerId) {
              const containerStatus = await deploymentService.getContainerStatus(agent.containerId);
              if (containerStatus === 'running') {
                await agentsCollection.updateOne(
                  { _id: agent._id },
                  { $set: { status: 'running', updatedAt: new Date(), errorMessage: undefined } }
                );
              }
            } else {
              const recovered = await deploymentService.recoverDeployingAgent(agentId);
              if (recovered) {
                await agentsCollection.updateOne(
                  { _id: agent._id },
                  {
                    $set: {
                      status: 'running',
                      containerId: recovered.containerId,
                      internalPort: 18789,
                      gatewayUrl: `ws://localhost:${recovered.gatewayPort}`,
                      gatewayToken: recovered.gatewayToken,
                      updatedAt: new Date(),
                      errorMessage: undefined,
                    },
                  }
                );
              }
            }
          } catch {
            // Ignore per-agent errors; next GET will retry
          }
        }
      });
    }

    return { agents: serializeAgents(agents) };
  });

  // POST /api/agents - Create new agent (rate limited: 5/min)
  fastify.post<{ Body: CreateAgentRequest }>('/', {
    schema: {
      tags: ['Agents'],
      summary: 'Create a new agent',
      description: 'Deploys a new OpenClaw agent container with the specified configuration. Rate limited to 5/min.',
      body: createAgentSchema,
      response: {
        201: createAgentResponseSchema,
        400: validationErrorSchema,
        403: planLimitErrorSchema,
      },
    },
    preHandler: requirePermission('agents.create'),
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // ── Plan Enforcement ─────────────────────────────────────────────
    const plan = (request.plan || 'unpaid') as PlanId;

    // Trial Expiration Check (plan resolved by auth middleware)
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Payment required',
        message: 'Upgrade to Professional to continue.',
        plan,
      });
    }

    // Agent count limit
    const agentFilter = organizationId ? { organizationId } : { userId };
    const currentAgentCount = await agentsCollection.countDocuments(agentFilter);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;
    if (limits.agents > 0 && currentAgentCount >= limits.agents) {
      return reply.code(403).send({
        error: 'Plan limit reached',
        message: `Your ${plan} plan allows ${limits.agents} agent(s). Upgrade to create more.`,
        currentCount: currentAgentCount,
        limit: limits.agents,
        plan,
      });
    }

    // Validate input
    const validationResult = createAgentSchema.safeParse(request.body);
    if (!validationResult.success) {
      return reply.code(400).send({ 
        error: 'Validation failed', 
        details: validationResult.error.errors 
      });
    }

    const { name, description, useCase, model, systemPrompt, skills, channels, templateId } = validationResult.data;

    const agent: Agent = {
      userId,
      organizationId, // Add organization ID
      name,
      description: description || '',
      useCase,
      status: 'deploying',
      deploymentType: 'managed',
      config: {
        model,
        systemPrompt: systemPrompt || '',
        skills: skills || [],
        tools: ['sessions_send'],
        browserEnabled: true,
        heartbeatEnabled: true,
        lobsterEnabled: true,
      },
      channels: (channels || []).map((type: string) => ({
        type: type as any,
        status: 'pending',
      })),
      metrics: {
        totalMessages: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await agentsCollection.insertOne(agent as any);
    const agentId = result.insertedId.toString();

    // Deploy in background with timeout protection
    const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max
    (async () => {
      try {
        // Race deployment against timeout
        const deployPromise = deploymentService.deployAgent({
          agentId,
          userId,
          organizationId,
          templateId,
          name,
          description: description || '',
          model,
          systemPrompt,
          skills,
          channels: (channels || []).map((type: string) => ({ type: type as any })),
          useCase: useCase || 'general',
          browserEnabled: true,
          heartbeatEnabled: true,
          lobsterEnabled: true,
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Deployment timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`)), DEPLOY_TIMEOUT_MS);
        });

        const deployment = await Promise.race([deployPromise, timeoutPromise]);

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

        // Auto-install skills from builder recommendations (best-effort, non-blocking)

        if (skills && skills.length > 0) {
          (async () => {
            // Brief delay to let gateway WS connect
            await new Promise(r => setTimeout(r, 3000));
            for (const slug of skills) {
              try {
                await clawHubService.installSkill(agentId, userId, slug, undefined, undefined, true);
                console.log(`[agent] Auto-installed skill "${slug}" for agent ${agentId}`);
              } catch (err) {
                console.warn(`[agent] Auto-install skill "${slug}" failed for agent ${agentId}:`, err instanceof Error ? err.message : err);
              }
            }
          })().catch(err => {
            console.warn('[agent] Skill auto-install batch failed:', err instanceof Error ? err.message : err);
          });
        }
      } catch (error) {
        console.error(`[agent] Deployment failed for ${agentId}:`, error instanceof Error ? error.message : error);
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
    })().catch(async (error) => {
      console.error(`[agent] Background deployment failed for ${agentId}:`, error instanceof Error ? error.message : error);
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
    });

    // Audit: Agent erstellt
    if (request.audit) {
      await request.audit({
        agentId,
        agentName: name,
        category: 'agent.lifecycle',
        action: 'agent.created',
        title: `Agent "${name}" erstellt`,
        description: `Neuer Agent "${name}" erstellt und Deployment gestartet. Model: ${model || 'default'}, Channels: ${(channels || []).join(', ') || 'keine'}`,
        reasoning: templateId ? `Basierend auf Template ${templateId}` : 'Manuell erstellt durch Benutzer',
        riskLevel: 'medium',
        outcome: 'success',
        resource: { type: 'agent', id: agentId, name },
        metadata: { model, useCase, templateId, channelCount: (channels || []).length },
      });
    }

    // Sync Stripe subscription quantity (non-blocking)
    syncAgentQuantity(userId, organizationId).catch(err => {
      console.warn('[agent] syncAgentQuantity failed after create:', err instanceof Error ? err.message : err);
    });

    return reply.code(201).send({ agent: serializeAgent({ ...agent, _id: agentId }) });
  });

  // POST /api/agents/apply-architect-config - Architect → Workspace Pipeline
  // Apply Architect config: create new agent or update existing, then deploy/regenerate workspace.
  fastify.post('/apply-architect-config', {
    schema: {
      tags: ['Agents'],
      summary: 'Apply Architect config',
      description: 'Creates a new agent or updates an existing one with Architect-generated config. New agents are deployed; existing agents get workspace regenerated.',
      body: z.object({
        config: architectConfigSchema,
        agentId: z.string().optional(),
      }),
      response: {
        200: z.object({ agent: z.any(), created: z.boolean() }),
        201: z.object({ agent: z.any(), created: z.boolean() }),
        400: validationErrorSchema,
        403: planLimitErrorSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.create'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;
    const { config: architectConfig, agentId: existingAgentId } = request.body as { config: any; agentId?: string };

    const plan = (request.plan || 'unpaid') as PlanId;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Payment required',
        message: 'Upgrade to Professional to continue.',
        plan,
      });
    }

    const { name, description, useCase, model, systemPrompt, skills, channels, missions: rawMissions, suggestMcpConnections } = architectConfig;
    const missions: any[] = Array.isArray(rawMissions) ? rawMissions : [];
    const channelTypes = (channels || []).filter((c: string) =>
      ['whatsapp', 'telegram', 'discord', 'slack', 'superchat', 'signal', 'imessage', 'webchat', 'googlechat', 'msteams', 'mattermost', 'matrix', 'feishu', 'line', 'bluebubbles'].includes(c)
    );

    if (existingAgentId) {
      // ── Update existing agent ─────────────────────────────────────
      if (!validateObjectId(existingAgentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      const agent = await agentsCollection.findOne(ownershipFilter(request, existingAgentId));
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      await agentsCollection.updateOne(
        { _id: new ObjectId(existingAgentId) } as any,
        {
          $set: {
            name,
            description: description || '',
            useCase: useCase || 'general',
            'config.model': model,
            'config.systemPrompt': systemPrompt || '',
            'config.skills': skills || [],
            channels: channelTypes.map((type: string) => ({ type, status: 'pending' as const })),
            updatedAt: new Date(),
          },
        }
      );

      // Sync agent_channels: ensure we have entries for each channel type
      const db = getDatabase();
      const agentChannelsCol = db.collection('agent_channels');
      const existingChannels = await agentChannelsCol.find({ agentId: existingAgentId }).toArray();
      const existingTypes = new Set(existingChannels.map((c: any) => c.type));
      for (const type of channelTypes) {
        if (!existingTypes.has(type)) {
          await agentChannelsCol.insertOne({
            agentId: existingAgentId,
            userId,
            type,
            status: 'pending',
            config: { dmPolicy: 'pairing', allowFrom: [] },
            credentials: { encrypted: encrypt('{}') },
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      try {
        await workspaceService.regeneratePersonaFiles(existingAgentId);
      } catch (err) {
        request.log.warn({ err, agentId: existingAgentId }, 'Workspace regenerate failed');
      }

      const updated = await agentsCollection.findOne({ _id: new ObjectId(existingAgentId) });
      return { agent: serializeAgent(updated!), created: false };
    }

    // ── Create new agent (same as POST /) ───────────────────────────
    const agentFilter: any = organizationId ? { organizationId } : { userId };
    const currentAgentCount = await agentsCollection.countDocuments(agentFilter);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.unpaid;
    if (limits.agents > 0 && currentAgentCount >= limits.agents) {
      return reply.code(403).send({
        error: 'Plan limit reached',
        message: `Your ${plan} plan allows ${limits.agents} agent(s). Upgrade to create more.`,
        currentCount: currentAgentCount,
        limit: limits.agents,
        plan,
      });
    }

    // ── Process missions into systemPrompt, heartbeatTasks, and pending cron jobs ──
    const reactiveMissions = missions.filter((m: any) => m.type === 'reactive');
    const heartbeatMissions = missions.filter((m: any) => m.type === 'heartbeat');
    const cronMissions = missions.filter((m: any) => m.type === 'cron');

    // Inject reactive mission instructions into systemPrompt
    let finalSystemPrompt = systemPrompt || '';
    if (reactiveMissions.length > 0) {
      const reactiveBlock = reactiveMissions
        .map((m: any) => `- ${m.trigger || 'incoming message'}: ${m.instruction}`)
        .join('\n');
      finalSystemPrompt += `\n\n## Automatic Actions (on every incoming message)\n${reactiveBlock}`;
    }

    const heartbeatTasks = heartbeatMissions.map((m: any) => m.instruction);

    const agent: Agent = {
      userId,
      organizationId,
      name,
      description: description || '',
      useCase: useCase || 'general',
      status: 'deploying',
      deploymentType: 'managed',
      config: {
        model,
        systemPrompt: finalSystemPrompt,
        skills: skills || [],
        tools: ['sessions_send'],
        browserEnabled: true,
        heartbeatEnabled: true,
        lobsterEnabled: true,
      },
      channels: channelTypes.map((type: string) => ({ type: type as any, status: 'pending' as const })),
      metrics: {
        totalMessages: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    // Store heartbeat tasks + pending cron missions + MCP recommendations on the agent doc
    if (heartbeatTasks.length > 0) (agent as any).heartbeatTasks = heartbeatTasks;
    if (cronMissions.length > 0) (agent as any).pendingMissions = cronMissions;
    if (suggestMcpConnections?.length) (agent as any).suggestMcpConnections = suggestMcpConnections;

    const result = await agentsCollection.insertOne(agent as any);
    const agentId = result.insertedId.toString();

    const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000;
    (async () => {
      try {
        const deployPromise = deploymentService.deployAgent({
          agentId,
          userId,
          organizationId,
          name,
          description: description || '',
          model,
          systemPrompt: finalSystemPrompt,
          skills: skills || [],
          channels: channelTypes.map((type: string) => ({ type: type as any })),
          useCase: useCase || 'general',
          browserEnabled: true,
          heartbeatEnabled: true,
          heartbeatTasks: heartbeatTasks.length > 0 ? heartbeatTasks : undefined,
          lobsterEnabled: true,
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Deployment timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`)), DEPLOY_TIMEOUT_MS);
        });
        const deployment = await Promise.race([deployPromise, timeoutPromise]);
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

        // ── Create pending cron missions after container is healthy ──
        if (cronMissions.length > 0) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            // Read fresh agent doc to get gateway credentials
            const freshAgent = await agentsCollection.findOne({ _id: result.insertedId });
            if (freshAgent?.gatewayUrl && freshAgent?.gatewayToken) {
              if (!gatewayManager.isConnected(agentId)) {
                await gatewayManager.connectAgent({ agentId, url: freshAgent.gatewayUrl, token: freshAgent.gatewayToken });
              }
              const client = gatewayManager.getClient(agentId);
              if (client) {
                let allOk = true;
                for (const m of cronMissions) {
                  try {
                    const payload: any = {
                      name: m.name || 'Mission',
                      sessionTarget: 'isolated',
                      payload: { kind: 'agentTurn', message: m.instruction },
                    };
                    if (m.schedule) payload.schedule = { kind: 'cron', expr: m.schedule };
                    else if (m.every) payload.schedule = { kind: 'every', everyMs: parseDuration(m.every) };
                    await client.addCronJob(payload);
                    fastify.log.info({ agentId, mission: m.name }, 'Cron mission created');
                  } catch (cronErr) {
                    allOk = false;
                    fastify.log.warn({ agentId, mission: m.name, err: cronErr }, 'Failed to create cron mission');
                  }
                }
                if (allOk) {
                  await agentsCollection.updateOne(
                    { _id: result.insertedId },
                    { $unset: { pendingMissions: '' } }
                  );
                }
              }
            }
          } catch (gwErr) {
            fastify.log.warn({ agentId, err: gwErr }, 'Failed to connect gateway for cron missions');
          }
        }

        syncAgentQuantity(userId, organizationId).catch(() => {});
      } catch (err) {
        await agentsCollection.updateOne(
          { _id: result.insertedId },
          { $set: { status: 'error', errorMessage: err instanceof Error ? err.message : 'Deployment failed', updatedAt: new Date() } }
        );
      }
    })().catch(async (error) => {
      console.error(`[agent] Background deployment failed for ${agentId}:`, error instanceof Error ? error.message : error);
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
    });

    return reply.code(201).send({ agent: serializeAgent({ ...agent, _id: agentId }), created: true });
  });

  // GET /api/agents/:id - Get single agent
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Get agent by ID',
      description: 'Returns a single agent with its configuration, channels, metrics, and status.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: getAgentResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Validate ObjectId
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    // Filter by organization if user is in one, otherwise by userId
    const filter: any = { _id: new ObjectId(request.params.id) };
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }

    let agent = await agentsCollection.findOne(filter);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Auto-sync: if DB says "deploying" but container is running, update DB
    if (agent.status === 'deploying') {
      if (agent.containerId) {
        const containerStatus = await deploymentService.getContainerStatus(agent.containerId);
        if (containerStatus === 'running') {
          await agentsCollection.updateOne(
            { _id: new ObjectId(request.params.id) } as any,
            { $set: { status: 'running', updatedAt: new Date(), errorMessage: undefined } }
          );
          agent = { ...agent, status: 'running' as const, errorMessage: undefined };
        }
      } else {
        const recovered = await deploymentService.recoverDeployingAgent(request.params.id);
        if (recovered) {
          await agentsCollection.updateOne(
            { _id: new ObjectId(request.params.id) } as any,
            {
              $set: {
                status: 'running',
                containerId: recovered.containerId,
                internalPort: 18789,
                gatewayUrl: `ws://localhost:${recovered.gatewayPort}`,
                gatewayToken: recovered.gatewayToken,
                updatedAt: new Date(),
                errorMessage: undefined,
              },
            }
          );
          agent = {
            ...agent,
            status: 'running' as const,
            containerId: recovered.containerId,
            internalPort: 18789,
            gatewayUrl: `ws://localhost:${recovered.gatewayPort}`,
            gatewayToken: recovered.gatewayToken,
            errorMessage: undefined,
          };
        }
      }
    }

    return { agent: serializeAgent(agent) };
  });

  // PATCH /api/agents/:id - Update agent (name, description, config)
  fastify.patch<{ Params: { id: string }; Body: { name?: string; description?: string; config?: Record<string, unknown> } }>('/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Update agent',
      description: 'Updates agent name, description, or config. Config updates are merged with existing config.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: updateAgentSchema,
      response: {
        200: getAgentResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    // Validate request body with Zod
    const validation = updateAgentSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Validation failed', details: validation.error.errors });
    }

    const filter: any = { _id: new ObjectId(request.params.id) };
    if (request.organizationId) {
      filter.organizationId = request.organizationId;
    } else {
      filter.userId = request.userId;
    }

    const agent = await agentsCollection.findOne(filter);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const { name, description, config: configUpdates } = validation.data;
    const setFields: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined && name !== '') setFields.name = name;
    if (description !== undefined) setFields.description = description;
    if (configUpdates && typeof configUpdates === 'object') {
      // Merge config updates with existing config
      for (const [key, value] of Object.entries(configUpdates)) {
        if (value !== undefined) {
          setFields[`config.${key}`] = value;
        }
      }
    }

    await agentsCollection.updateOne(filter, { $set: setFields });

    // Regenerate persona files if name/description changed on a running agent
    if ((name || description !== undefined) && agent.status === 'running') {
      try {
        await workspaceService.regeneratePersonaFiles(request.params.id);
      } catch (err) {
        console.warn(`[agent] Persona file regeneration failed for ${request.params.id}:`, err instanceof Error ? err.message : err);
      }
    }

    const updated = await agentsCollection.findOne(filter);
    return { agent: updated ? serializeAgent(updated) : null };
  });

  // Helper: build ownership filter (works for both personal and org context)
  function ownershipFilter(request: any, agentId: string) {
    const filter: any = { _id: new ObjectId(agentId) };
    if (request.organizationId) {
      filter.organizationId = request.organizationId;
    } else {
      filter.userId = request.userId;
    }
    return filter;
  }

  // POST /api/agents/:id/pause - Pause agent
  fastify.post<{ Params: { id: string } }>('/:id/pause', {
    schema: {
      tags: ['Agents'],
      summary: 'Pause agent',
      description: 'Stops the agent container. The agent will not respond to messages until resumed.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.deploy'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const agent = await agentsCollection.findOne(ownershipFilter(request, request.params.id));

    if (!agent || !agent.containerId) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    await deploymentService.stopAgent(agent.containerId);
    await agentsCollection.updateOne(
      { _id: new ObjectId(request.params.id) } as any,
      { $set: { status: 'stopped', updatedAt: new Date() } }
    );

    if (request.audit) {
      await request.audit({
        agentId: request.params.id,
        agentName: agent.name,
        category: 'agent.lifecycle',
        action: 'agent.paused',
        title: `Agent "${agent.name}" pausiert`,
        description: `Agent-Container gestoppt. Agent reagiert nicht mehr auf Nachrichten bis zur Wiederaufnahme.`,
        riskLevel: 'medium',
        outcome: 'success',
        resource: { type: 'agent', id: request.params.id, name: agent.name },
      });
    }

    return { success: true };
  });

  // POST /api/agents/:id/resume - Resume agent
  fastify.post<{ Params: { id: string } }>('/:id/resume', {
    schema: {
      tags: ['Agents'],
      summary: 'Resume agent',
      description: 'Starts the agent container and waits for the gateway to become healthy.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        403: planLimitErrorSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.deploy'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    // ── Trial Expiration Check ─────────────────────────────────────────
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Payment required',
        message: 'Upgrade to Professional to continue.',
        plan: request.plan,
      });
    }

    const agent = await agentsCollection.findOne(ownershipFilter(request, request.params.id));

    if (!agent || !agent.containerId) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    await deploymentService.startAgent(agent.containerId);

    // Wait for gateway to be healthy before marking as running
    try {
      const { dockerService } = await import('../../services/docker.service.js');
      await dockerService.waitForHealthy(agent.containerId, 60000);
    } catch (err) {
      console.warn(`[agent] Health check after resume timed out for ${request.params.id}, marking as running anyway`);
    }

    await agentsCollection.updateOne(
      { _id: new ObjectId(request.params.id) } as any,
      { $set: { status: 'running', updatedAt: new Date() } }
    );

    if (request.audit) {
      await request.audit({
        agentId: request.params.id,
        agentName: agent.name,
        category: 'agent.lifecycle',
        action: 'agent.resumed',
        title: `Agent "${agent.name}" wiederaufgenommen`,
        description: `Agent-Container gestartet und Gateway ist bereit. Agent nimmt Nachrichten wieder entgegen.`,
        riskLevel: 'medium',
        outcome: 'success',
        resource: { type: 'agent', id: request.params.id, name: agent.name },
      });
    }

    return { success: true };
  });

  // POST /api/agents/:id/redeploy - Recreate container with latest image
  fastify.post<{ Params: { id: string } }>('/:id/redeploy', {
    schema: {
      tags: ['Agents'],
      summary: 'Redeploy agent',
      description: 'Destroys the current container and creates a new one with the latest Docker image. Preserves workspace, config, memory, and sessions.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        403: planLimitErrorSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.deploy'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Payment required',
        message: 'Upgrade to Professional to continue.',
        plan: request.plan,
      });
    }

    const agent = await agentsCollection.findOne(ownershipFilter(request, request.params.id));

    if (!agent || !agent.containerId || !agent.internalPort || !agent.gatewayToken) {
      return reply.code(404).send({ error: 'Agent not found or not deployed' });
    }

    await agentsCollection.updateOne(
      { _id: new ObjectId(request.params.id) } as any,
      { $set: { status: 'deploying', updatedAt: new Date() } }
    );

    try {
      const newContainerId = await deploymentService.redeployAgent(
        request.params.id,
        agent.containerId,
        agent.internalPort,
        agent.gatewayToken
      );

      await agentsCollection.updateOne(
        { _id: new ObjectId(request.params.id) } as any,
        { $set: { containerId: newContainerId, status: 'running', updatedAt: new Date() } }
      );

      if (request.audit) {
        await request.audit({
          agentId: request.params.id,
          agentName: agent.name,
          category: 'agent.lifecycle',
          action: 'agent.redeployed',
          title: `Agent "${agent.name}" redeployed`,
          description: `Container neu erstellt mit aktuellem Image. Workspace und Konfiguration beibehalten.`,
          riskLevel: 'medium',
          outcome: 'success',
          resource: { type: 'agent', id: request.params.id, name: agent.name },
        });
      }

      return { success: true };
    } catch (error) {
      await agentsCollection.updateOne(
        { _id: new ObjectId(request.params.id) } as any,
        { $set: { status: 'error', errorMessage: error instanceof Error ? error.message : 'Redeploy failed', updatedAt: new Date() } }
      );
      const msg = error instanceof Error ? error.message : 'Redeploy failed';
      return reply.code(502).send({ error: msg });
    }
  });

  // DELETE /api/agents/:id - Delete agent (rate limited: 10/min)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Agents'],
      summary: 'Delete agent',
      description: 'Permanently deletes an agent, its container, and workspace files. Requires admin role. Rate limited to 10/min.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.delete'),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const agent = await agentsCollection.findOne(ownershipFilter(request, request.params.id));

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Clean up container (best-effort — don't block DB deletion)
    if (agent.containerId) {
      try {
        await deploymentService.deleteAgent(agent.containerId);
      } catch {
        // Container may already be gone — proceed with DB cleanup
      }
    }

    // Clean up workspace files (use configured workspace dir, not hardcoded path)
    try {
      const { rm } = await import('fs/promises');
      const { join } = await import('path');
      const workspacePath = join(config.openclawWorkspaceDir, request.params.id);
      await rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Workspace cleanup failed — not critical
    }

    await agentsCollection.deleteOne({ _id: new ObjectId(request.params.id) } as any);

    if (request.audit) {
      await request.audit({
        agentId: request.params.id,
        agentName: agent.name,
        category: 'agent.lifecycle',
        action: 'agent.deleted',
        title: `Agent "${agent.name}" gelöscht`,
        description: `Agent permanent gelöscht inkl. Container und Workspace-Dateien. Diese Aktion kann nicht rückgängig gemacht werden.`,
        riskLevel: 'critical',
        outcome: 'success',
        resource: { type: 'agent', id: request.params.id, name: agent.name },
        metadata: { hadContainer: !!agent.containerId },
      });
    }

    // Sync Stripe subscription quantity after deletion (non-blocking)
    const userId = request.userId;
    const organizationId = request.organizationId;
    syncAgentQuantity(userId, organizationId).catch(err => {
      console.warn('[agent] syncAgentQuantity failed after delete:', err instanceof Error ? err.message : err);
    });

    return { success: true };
  });
}
