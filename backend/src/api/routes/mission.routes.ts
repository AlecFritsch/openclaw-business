// Mission CRUD + webhook trigger routes

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../../config/database.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { validateObjectId } from '../../validation/schemas.js';
import { executeMission, registerTrigger, registerTriggers, unregisterTrigger, missionEvents } from '../../services/mission-engine.service.js';
import { gatewayManager } from '../../services/gateway-ws.service.js';
import type { MissionStatus } from '@openclaw-business/shared';
import crypto from 'crypto';

const triggerSchema = z.object({
  type: z.enum(['schedule', 'interval', 'event', 'webhook', 'channel_message', 'mission_complete', 'manual']),
  config: z.record(z.unknown()).default({}),
});

const deliverySchema = z.object({
  channel: z.string().optional(),
  target: z.string().optional(),
}).optional();

const triggerConfigSchema = z.object({
  id: z.string().min(1),
  schedule: z.string().optional(),
  every: z.string().optional(),
  tz: z.string().optional(),
}).refine(t => t.schedule || t.every, { message: 'Each trigger needs schedule or every' });

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  trigger: triggerSchema.optional(),
  prompt: z.string().min(1).max(10000),
  capabilities: z.array(z.string()).optional().default([]),
  delivery: deliverySchema,
  dependencies: z.array(z.string()).optional().default([]),
  /** One mission per use case: multiple triggers */
  triggers: z.array(triggerConfigSchema).optional(),
}).refine(b => b.trigger || (b.triggers && b.triggers.length > 0), { message: 'Need trigger or triggers' });

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['idle', 'paused', 'archived']).optional(),
  trigger: triggerSchema.optional(),
  prompt: z.string().min(1).max(10000).optional(),
  capabilities: z.array(z.string()).optional(),
  delivery: deliverySchema,
  dependencies: z.array(z.string()).optional(),
});

function db() { return getDatabase(); }
function missions() { return db().collection('missions'); }
function missionRuns() { return db().collection('mission_runs'); }
function agents() { return db().collection('agents'); }

/** Ensure gateway is connected before registering cron triggers (e.g. right after deploy) */
async function ensureGatewayConnected(agentId: string, organizationId: string | undefined): Promise<boolean> {
  if (!organizationId) return false;
  const agent = await agents().findOne({ _id: new ObjectId(agentId), organizationId });
  if (!agent?.gatewayUrl || !agent?.gatewayToken) return false;
  if (!gatewayManager.isConnected(agentId)) {
    await gatewayManager.connectAgent({ agentId, url: agent.gatewayUrl, token: agent.gatewayToken });
  }
  return !!gatewayManager.getClient(agentId);
}

async function triggerMissionWebhook(
  request: { params: { id: string; missionId: string }; headers: { 'x-mission-secret'?: string }; body: unknown },
  reply: { code: (statusCode: number) => { send: (payload: { error: string }) => unknown }; notFound: (msg: string) => unknown }
) {
  if (!validateObjectId(request.params.missionId)) {
    return reply.code(400).send({ error: 'Invalid mission ID format' });
  }
  const doc = await missions().findOne({
    _id: new ObjectId(request.params.missionId),
    agentId: request.params.id,
    'trigger.type': 'webhook',
  });
  if (!doc) return reply.notFound('Mission not found');

  // Validate secret
  const expected = doc.trigger?.config?.secret as string | undefined;
  if (expected) {
    const provided = request.headers['x-mission-secret'];
    if (provided !== expected) return reply.code(401).send({ error: 'Invalid secret' });
  }

  const runId = await executeMission(request.params.missionId, { type: 'webhook', input: request.body });
  return { runId };
}

export async function missionRoutes(fastify: FastifyInstance) {
  const defaultStats = { totalRuns: 0, lastRunAt: null, avgDurationMs: 0, successRate: 1, consecutiveFailures: 0 };

  // POST /api/agents/:id/missions — create
  fastify.post<{ Params: { id: string } }>('/:id/missions', {
    schema: { tags: ['Missions'], body: createSchema, params: z.object({ id: z.string() }) },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    const orgId = request.organizationId;
    const body = request.body as z.infer<typeof createSchema>;
    const now = new Date();

    // Multi-trigger: one mission per use case
    if (body.triggers && body.triggers.length > 0) {
      const doc = {
        agentId,
        organizationId: orgId,
        userId: request.userId,
        name: body.name,
        description: body.description || '',
        status: 'idle' as MissionStatus,
        trigger: { type: 'manual' as const, config: {} },
        prompt: body.prompt,
        capabilities: body.capabilities || [],
        delivery: body.delivery || undefined,
        dependencies: body.dependencies || [],
        currentRunId: null,
        stats: defaultStats,
        cronJobId: null as string | null,
        cronJobIds: [] as string[],
        triggerConfigs: body.triggers,
        createdAt: now,
        updatedAt: now,
      };
      const result = await missions().insertOne(doc);
      // Ensure gateway connected (e.g. right after deploy) so crons can be registered
      await ensureGatewayConnected(agentId, orgId).catch((err) => {
        request.log.warn({ agentId, err: err instanceof Error ? err.message : String(err) }, 'ensureGatewayConnected failed — crons will retry on next gateway connect');
      });
      const cronJobIds = await registerTriggers(
        { ...doc, _id: result.insertedId },
        body.triggers,
      );
      await missions().updateOne(
        { _id: result.insertedId },
        { $set: { cronJobIds, updatedAt: new Date() } },
      );
      return reply.code(201).send({
        mission: { ...doc, _id: result.insertedId.toString(), cronJobIds },
      });
    }

    // Single trigger (legacy)
    const trigger = body.trigger!;
    if (trigger.type === 'webhook' && !trigger.config.secret) {
      trigger.config.secret = crypto.randomBytes(16).toString('hex');
    }

    const doc = {
      agentId,
      organizationId: orgId,
      userId: request.userId,
      name: body.name,
      description: body.description || '',
      status: 'idle' as MissionStatus,
      trigger,
      prompt: body.prompt,
      capabilities: body.capabilities || [],
      delivery: body.delivery || undefined,
      dependencies: body.dependencies || [],
      currentRunId: null,
      stats: defaultStats,
      cronJobId: null as string | null,
      createdAt: now,
      updatedAt: now,
    };

    const result = await missions().insertOne(doc);
    const missionId = result.insertedId.toString();

    const cronJobId = await registerTrigger({ ...doc, _id: result.insertedId });
    if (cronJobId) {
      await missions().updateOne({ _id: result.insertedId }, { $set: { cronJobId } });
    }

    return reply.code(201).send({ mission: { ...doc, _id: missionId, cronJobId } });
  });

  // GET /api/agents/:id/missions — list
  fastify.get<{ Params: { id: string } }>('/:id/missions', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string() }) },
    preHandler: requirePermission('agents.view'),
  }, async (request) => {
    const docs = await missions()
      .find({ agentId: request.params.id, organizationId: request.organizationId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return { missions: docs.map((d) => ({ ...d, _id: d._id.toString() })) };
  });

  // GET /api/agents/:id/missions/:missionId — detail + runs
  fastify.get<{ Params: { id: string; missionId: string } }>('/:id/missions/:missionId', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string(), missionId: z.string() }) },
    preHandler: requirePermission('agents.view'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.missionId)) {
      return reply.code(400).send({ error: 'Invalid mission ID format' });
    }
    const doc = await missions().findOne({
      _id: new ObjectId(request.params.missionId),
      agentId: request.params.id,
      organizationId: request.organizationId,
    });
    if (!doc) return reply.notFound('Mission not found');

    const runs = await missionRuns()
      .find({ missionId: request.params.missionId })
      .sort({ startedAt: -1 })
      .limit(20)
      .toArray();

    return {
      mission: { ...doc, _id: doc._id.toString() },
      runs: runs.map((r) => ({ ...r, _id: r._id.toString() })),
    };
  });

  // PATCH /api/agents/:id/missions/:missionId — update
  fastify.patch<{ Params: { id: string; missionId: string } }>('/:id/missions/:missionId', {
    schema: { tags: ['Missions'], body: updateSchema, params: z.object({ id: z.string(), missionId: z.string() }) },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.missionId)) {
      return reply.code(400).send({ error: 'Invalid mission ID format' });
    }
    const body = request.body as z.infer<typeof updateSchema>;
    const filter = {
      _id: new ObjectId(request.params.missionId),
      agentId: request.params.id,
      organizationId: request.organizationId,
    };
    const existing = await missions().findOne(filter);
    if (!existing) return reply.notFound('Mission not found');

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.prompt !== undefined) update.prompt = body.prompt;
    if (body.capabilities !== undefined) update.capabilities = body.capabilities;
    if (body.delivery !== undefined) update.delivery = body.delivery;
    if (body.dependencies !== undefined) update.dependencies = body.dependencies;

    // Trigger change → re-register
    if (body.trigger) {
      await unregisterTrigger(existing as unknown as { agentId: string; cronJobId: string | null });
      update.trigger = body.trigger;
      update.cronJobId = null;
      const merged = { ...existing, ...update, _id: existing._id } as { _id: ObjectId; agentId: string; name: string; prompt: string; trigger: { type: string; config: Record<string, unknown> } };
      const newCronId = await registerTrigger(merged as Parameters<typeof registerTrigger>[0]);
      if (newCronId) update.cronJobId = newCronId;
    }

    // Status change
    if (body.status) {
      update.status = body.status;
      if (body.status === 'paused') {
        // Disable cron if exists
        if (existing.cronJobId) {
          try {
            const gw = gatewayManager.getClient(existing.agentId);
            if (gw) await gw.disableCronJob(existing.cronJobId);
          } catch {}
        }
      } else if (body.status === 'idle' && existing.status === 'paused') {
        // Re-enable cron
        if (existing.cronJobId) {
          try {
            const gw = gatewayManager.getClient(existing.agentId);
            if (gw) await gw.enableCronJob(existing.cronJobId);
          } catch {}
        }
        update['stats.consecutiveFailures'] = 0;
      }
    }

    await missions().updateOne(filter, { $set: update });
    const updated = await missions().findOne(filter);
    return { mission: { ...updated, _id: updated!._id.toString() } };
  });

  // DELETE /api/agents/:id/missions/:missionId
  fastify.delete<{ Params: { id: string; missionId: string } }>('/:id/missions/:missionId', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string(), missionId: z.string() }) },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.missionId)) {
      return reply.code(400).send({ error: 'Invalid mission ID format' });
    }
    const filter = {
      _id: new ObjectId(request.params.missionId),
      agentId: request.params.id,
      organizationId: request.organizationId,
    };
    const existing = await missions().findOne(filter);
    if (!existing) return reply.notFound('Mission not found');

    await unregisterTrigger(existing as unknown as { agentId: string; cronJobId: string | null });
    await missions().deleteOne(filter);
    await missionRuns().deleteMany({ missionId: request.params.missionId });
    return { ok: true };
  });

  // POST /api/agents/:id/missions/:missionId/run — manual trigger
  fastify.post<{ Params: { id: string; missionId: string } }>('/:id/missions/:missionId/run', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string(), missionId: z.string() }) },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    if (!validateObjectId(request.params.missionId)) {
      return reply.code(400).send({ error: 'Invalid mission ID format' });
    }
    const doc = await missions().findOne({
      _id: new ObjectId(request.params.missionId),
      agentId: request.params.id,
      organizationId: request.organizationId,
    });
    if (!doc) return reply.notFound('Mission not found');
    if (doc.status === 'running') return reply.code(409).send({ error: 'Mission is already running' });

    const runId = await executeMission(request.params.missionId, { type: 'manual' });
    return { runId };
  });

  // POST /api/agents/:id/missions/:missionId/webhook — external trigger
  fastify.post<{ Params: { id: string; missionId: string }; Headers: { 'x-mission-secret'?: string } }>('/:id/missions/:missionId/webhook', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string(), missionId: z.string() }) },
  }, async (request, reply) => {
    return triggerMissionWebhook(request, reply);
  });

  // GET /api/agents/:id/missions/events — SSE for mission lifecycle
  fastify.get<{ Params: { id: string } }>('/:id/missions/events', {
    schema: { tags: ['Missions'], params: z.object({ id: z.string() }) },
    preHandler: requirePermission('agents.view'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const handler = (data: any) => {
      if (data.agentId === agentId) {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    missionEvents.on('mission:started', handler);
    missionEvents.on('mission:completed', handler);

    request.raw.on('close', () => {
      missionEvents.off('mission:started', handler);
      missionEvents.off('mission:completed', handler);
    });
  });
}

/** Public webhook trigger route (no Clerk auth) for external systems */
export async function missionWebhookPublicRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string; missionId: string }; Headers: { 'x-mission-secret'?: string } }>(
    '/:id/missions/:missionId/webhook',
    {
      schema: { tags: ['Missions'], params: z.object({ id: z.string(), missionId: z.string() }) },
    },
    async (request, reply) => triggerMissionWebhook(request, reply)
  );
}
