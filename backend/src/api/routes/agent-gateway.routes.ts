// Agent Gateway Routes - Real-time interaction with running OpenClaw gateways
// Provides session listing, message history, health, and log streaming

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateObjectId } from '../../validation/schemas.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  gatewayHealthSchema,
  gatewaySessionSchema,
} from '../../validation/response-schemas.js';
import { gatewayManager } from '../../services/gateway-ws.service.js';
import { dockerService } from '../../services/docker.service.js';
import { retryMissionTriggers } from '../../services/mission-engine.service.js';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';

export async function agentGatewayRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const agentsCollection = db.collection('agents');

  // ── Rate limit for gateway mutations (cron, message, config changes) ──
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method !== 'GET' && !routeOptions.config?.rateLimit) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: { max: 60, timeWindow: '1 minute' },
      };
    }
  });

  // ── Trial guard for ALL mutation routes in this scope ────────────
  // Read-only routes (GET) are allowed; write operations are blocked
  // when the user's trial has expired.
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return; // read-only is fine
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }
  });

  // Helper: ensure gateway connection (supports both personal and org context)
  async function ensureConnection(agentId: string, userId: string, organizationId?: string) {
    const filter: any = { _id: new ObjectId(agentId) };
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }
    const agent = await agentsCollection.findOne(filter);

    if (!agent) throw new Error('Agent not found');
    if (!agent.gatewayUrl || !agent.gatewayToken) {
      throw new Error('Agent not deployed or missing gateway info');
    }

    if (!gatewayManager.isConnected(agentId)) {
      await gatewayManager.connectAgent({
        agentId,
        url: agent.gatewayUrl,
        token: agent.gatewayToken,
      });
    }

    const client = gatewayManager.getClient(agentId);
    if (!client) throw new Error('Failed to connect to gateway');

    // Retry pending missions (cron jobs that failed to create during deploy)
    if ((agent as any).pendingMissions?.length) {
      const pd = (s: string) => { const m = s.match(/^(\d+)\s*(s|m|h|d)$/i); if (!m) return 1800000; const n = parseInt(m[1]); return n * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase() as 's'|'m'|'h'|'d'] || 60000); };
      let allOk = true;
      for (const m of (agent as any).pendingMissions) {
        try {
          const job: any = { name: m.name || 'Mission', sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: m.instruction } };
          if (m.schedule) job.schedule = { kind: 'cron', expr: m.schedule };
          else if (m.every) job.schedule = { kind: 'every', everyMs: pd(m.every) };
          await client.addCronJob(job);
        } catch { allOk = false; }
      }
      if (allOk) {
        await agentsCollection.updateOne({ _id: new ObjectId(agentId) }, { $unset: { pendingMissions: '' } }).catch(() => {});
      }
    }

    // Retry mission triggers (multi-trigger missions where gateway wasn't ready at creation)
    await retryMissionTriggers(agentId).catch((err) => {
      fastify.log.warn({ agentId, err: err instanceof Error ? err.message : String(err) }, 'retryMissionTriggers failed');
    });

    return { client, agent };
  }

  // GET /api/agents/:id/gateway/health - Gateway health status
  fastify.get<{ Params: { id: string } }>('/:id/gateway/health', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get gateway health status',
      description: 'Returns the health status of the OpenClaw gateway for the specified agent, including uptime and version information.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ health: gatewayHealthSchema }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const health = await client.getHealth();
      return { health };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get health';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/sessions - List active sessions
  fastify.get<{ Params: { id: string } }>('/:id/gateway/sessions', {
    schema: {
      tags: ['Gateway'],
      summary: 'List active gateway sessions',
      description: 'Returns all active sessions on the OpenClaw gateway for the specified agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ sessions: z.array(gatewaySessionSchema) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const sessions = await client.listSessions();
      return { sessions };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list sessions';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/history?sessionKey=...&limit=... - Session message history (query-param version)
  fastify.get<{ Params: { id: string }; Querystring: { sessionKey: string; limit?: string } }>(
    '/:id/gateway/history',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Get session message history',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          sessionKey: z.string(),
          limit: z.string().optional(),
        }),
        response: {
          200: z.object({ messages: z.array(z.any()) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        const limit = parseInt(request.query.limit || '50') || 50;
        const messages = await client.getSessionHistory(request.query.sessionKey, limit);
        return { messages };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get history';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // GET /api/agents/:id/gateway/sessions/:key/history - Session message history (legacy path-param version)
  fastify.get<{ Params: { id: string; key: string }; Querystring: { limit?: string } }>(
    '/:id/gateway/sessions/:key/history',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Get session message history',
        description: 'Returns the message history for a specific session on the OpenClaw gateway, with optional limit parameter.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          key: z.string().describe('Session key'),
        }),
        querystring: z.object({
          limit: z.string().optional().describe('Maximum number of messages to return (default: 50)'),
        }),
        response: {
          200: z.object({ messages: z.array(z.any()) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        const limit = parseInt(request.query.limit || '50') || 50;
        const messages = await client.getSessionHistory(request.params.key, limit);
        return { messages };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get history';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/gateway/send - Send message to a session
  fastify.post<{
    Params: { id: string };
    Body: { sessionKey: string; text: string };
  }>('/:id/gateway/send', {
    schema: {
      tags: ['Gateway'],
      summary: 'Send message to a session',
      description: 'Sends a text message to a specific session on the OpenClaw gateway. Requires sessionKey and text in the request body.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        sessionKey: z.string().describe('Target session key'),
        text: z.string().describe('Message text to send'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { sessionKey, text } = request.body;
    if (!sessionKey || !text) {
      return reply.code(400).send({ error: 'sessionKey and text are required' });
    }

    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const result = await client.sendMessage(sessionKey, text);
      return { success: true as const, runId: result.runId || null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/logs - Get container + gateway logs
  fastify.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    '/:id/gateway/logs',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Get container and gateway logs',
        description: 'Returns the Docker container logs for the specified agent. Requires the agent to be deployed with a container.',
        params: z.object({ id: z.string().describe('Agent ID') }),
        querystring: z.object({
          lines: z.string().optional().describe('Number of log lines to return (default: 100)'),
        }),
        response: {
          200: z.object({ logs: z.string() }),
          400: errorResponseSchema,
          404: notFoundErrorSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      const logFilter: any = { _id: new ObjectId(agentId) as any };
      if (request.organizationId) {
        logFilter.organizationId = request.organizationId;
      } else {
        logFilter.userId = request.userId;
      }
      const agent = await agentsCollection.findOne(logFilter);

      if (!agent?.containerId) {
        return reply.code(404).send({ error: 'Agent not deployed' });
      }

      try {
        const lines = parseInt(request.query.lines || '100') || 100;
        const logs = await dockerService.getContainerLogs(agent.containerId, lines);
        return { logs };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get logs';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // GET /api/agents/:id/gateway/stats - Container resource stats
  fastify.get<{ Params: { id: string } }>('/:id/gateway/stats', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get container resource stats',
      description: 'Returns Docker container resource usage statistics (CPU, memory, network) and status for the specified agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ stats: z.any(), status: z.any() }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const statsFilter: any = { _id: new ObjectId(agentId) as any };
    if (request.organizationId) {
      statsFilter.organizationId = request.organizationId;
    } else {
      statsFilter.userId = request.userId;
    }
    const agent = await agentsCollection.findOne(statsFilter);

    if (!agent?.containerId) {
      return reply.code(404).send({ error: 'Agent not deployed' });
    }

    try {
      const stats = await dockerService.getContainerStats(agent.containerId);
      const status = await dockerService.getContainerStatus(agent.containerId);
      return { stats, status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get stats';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/cron - List cron jobs
  fastify.get<{ Params: { id: string } }>('/:id/gateway/cron', {
    schema: {
      tags: ['Gateway'],
      summary: 'List cron jobs',
      description: 'Returns all cron jobs configured on the OpenClaw gateway for the specified agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ jobs: z.array(z.any()) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const jobs = await client.listCronJobs();
      return { jobs };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list cron jobs';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/gateway/cron - Add a cron job
  fastify.post<{
    Params: { id: string };
    Body: { name: string; schedule?: string; at?: string; every?: string; message?: string; timezone?: string; sessionTarget?: string; delivery?: { mode: string; to?: string } };
  }>('/:id/gateway/cron', {
    schema: {
      tags: ['Gateway'],
      summary: 'Add a cron job',
      description: 'Creates a new cron job on the OpenClaw gateway. Requires a name and at least one of schedule, at, or every.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        name: z.string().describe('Job name'),
        schedule: z.string().optional().describe('Cron expression (e.g. "0 9 * * *")'),
        at: z.string().optional().describe('ISO 8601 datetime for one-shot execution'),
        every: z.string().optional().describe('Interval string (e.g. "30m", "2h")'),
        message: z.string().optional().describe('Message/instruction for the job'),
        timezone: z.string().optional().describe('IANA timezone (e.g. "Europe/Berlin")'),
        sessionTarget: z.enum(['main', 'isolated']).optional().describe('Session target (default: isolated)'),
        delivery: z.object({ mode: z.enum(['announce', 'webhook', 'none']), to: z.string().optional() }).optional(),
      }),
      response: {
        201: z.object({ jobId: z.string() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { name, schedule, at, every, message, timezone, sessionTarget, delivery } = request.body;
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!schedule && !at && !every) {
      return reply.code(400).send({ error: 'One of schedule, at, or every is required' });
    }

    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const target = sessionTarget || 'isolated';
      const payloadKind = target === 'main' ? 'systemEvent' : 'agentTurn';
      const payloadField = target === 'main' ? { kind: payloadKind, text: message || name } : { kind: payloadKind, message: message || name };
      const job: any = {
        name,
        sessionTarget: target,
        payload: payloadField,
      };
      if (schedule) job.schedule = { kind: 'cron', expr: schedule, ...(timezone ? { tz: timezone } : {}) };
      else if (at) job.schedule = { kind: 'at', at };
      else if (every) {
        const pd = (s: string) => { const m = s.match(/^(\d+)\s*(s|m|h|d)$/i); if (!m) return 1800000; const n = parseInt(m[1]); return n * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase() as 's'|'m'|'h'|'d'] || 60000); };
        job.schedule = { kind: 'every', everyMs: pd(every) };
      }
      if (delivery) job.delivery = delivery;
      const jobId = await client.addCronJob(job);
      return reply.code(201).send({ jobId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to add cron job';
      return reply.code(502).send({ error: msg });
    }
  });

  // DELETE /api/agents/:id/gateway/cron/:jobId - Remove a cron job
  fastify.delete<{ Params: { id: string; jobId: string } }>(
    '/:id/gateway/cron/:jobId',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Remove a cron job',
        description: 'Deletes a specific cron job from the OpenClaw gateway by job ID.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          jobId: z.string().describe('Cron job ID'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.removeCronJob(request.params.jobId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove cron job';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/gateway/cron/:jobId/run - Run a cron job immediately
  fastify.post<{ Params: { id: string; jobId: string }; Body: { force?: boolean } }>(
    '/:id/gateway/cron/:jobId/run',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Run a cron job immediately',
        description: 'Triggers immediate execution of a specific cron job on the OpenClaw gateway. Optionally force execution even if the job is disabled.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          jobId: z.string().describe('Cron job ID'),
        }),
        body: z.object({
          force: z.boolean().optional().describe('Force execution even if job is disabled'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.runCronJob(request.params.jobId, request.body?.force);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run cron job';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/gateway/cron/:jobId/enable - Enable a cron job
  fastify.post<{ Params: { id: string; jobId: string } }>(
    '/:id/gateway/cron/:jobId/enable',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Enable a cron job',
        description: 'Enables a previously disabled cron job on the OpenClaw gateway.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          jobId: z.string().describe('Cron job ID'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.enableCronJob(request.params.jobId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to enable cron job';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/gateway/cron/:jobId/disable - Disable a cron job
  fastify.post<{ Params: { id: string; jobId: string } }>(
    '/:id/gateway/cron/:jobId/disable',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Disable a cron job',
        description: 'Disables a cron job on the OpenClaw gateway, preventing it from running on schedule.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          jobId: z.string().describe('Cron job ID'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.disableCronJob(request.params.jobId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to disable cron job';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // GET /api/agents/:id/gateway/cron/:jobId/runs - Get cron job run history
  fastify.get<{ Params: { id: string; jobId: string }; Querystring: { limit?: string } }>(
    '/:id/gateway/cron/:jobId/runs',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Get cron job run history',
        description: 'Returns the execution history of a specific cron job on the OpenClaw gateway, with optional limit.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          jobId: z.string().describe('Cron job ID'),
        }),
        querystring: z.object({
          limit: z.string().optional().describe('Maximum number of runs to return (default: 20)'),
        }),
        response: {
          200: z.object({ runs: z.array(z.any()) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        const limit = parseInt(request.query.limit || '20') || 20;
        const runs = await client.cronRuns(request.params.jobId, limit);
        return { runs };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get cron runs';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Config RPC Routes — read/write OpenClaw config via Gateway WS
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/gateway/config - Read current OpenClaw config
  fastify.get<{ Params: { id: string } }>('/:id/gateway/config', {
    schema: {
      tags: ['Gateway'],
      summary: 'Read current OpenClaw config',
      description: 'Returns the current OpenClaw configuration (JSON5) and its content hash from the running gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ config: z.any(), hash: z.string() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const { config, hash } = await client.configGet();
      return { config, hash };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get config';
      return reply.code(502).send({ error: message });
    }
  });

  // PATCH /api/agents/:id/gateway/config - Partial config update (merge-patch)
  fastify.patch<{
    Params: { id: string };
    Body: { raw: string; baseHash: string; sessionKey?: string; restartDelayMs?: number };
  }>('/:id/gateway/config', {
    schema: {
      tags: ['Gateway'],
      summary: 'Partial config update (merge-patch)',
      description: 'Applies a partial merge-patch to the OpenClaw configuration. Requires the raw config string and base hash for optimistic concurrency.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        raw: z.string().describe('Raw JSON5 config patch'),
        baseHash: z.string().describe('Hash of the config being patched (optimistic concurrency)'),
        sessionKey: z.string().optional().describe('Optional session key to notify after restart'),
        restartDelayMs: z.number().optional().describe('Delay in ms before restarting the gateway'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const { raw, baseHash, sessionKey, restartDelayMs } = request.body;
    if (!raw || !baseHash) {
      return reply.code(400).send({ error: 'raw and baseHash are required' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      await client.configPatch(raw, baseHash, { sessionKey, restartDelayMs });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to patch config';
      return reply.code(502).send({ error: message });
    }
  });

  // PUT /api/agents/:id/gateway/config - Replace entire config + restart
  fastify.put<{
    Params: { id: string };
    Body: { raw: string; baseHash?: string; sessionKey?: string; restartDelayMs?: number };
  }>('/:id/gateway/config', {
    schema: {
      tags: ['Gateway'],
      summary: 'Replace entire config and restart',
      description: 'Replaces the full OpenClaw configuration and triggers a gateway restart. The raw config string is required.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        raw: z.string().describe('Full JSON5 config to apply'),
        baseHash: z.string().optional().describe('Optional hash for optimistic concurrency'),
        sessionKey: z.string().optional().describe('Optional session key to notify after restart'),
        restartDelayMs: z.number().optional().describe('Delay in ms before restarting the gateway'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const { raw, baseHash, sessionKey, restartDelayMs } = request.body;
    if (!raw) {
      return reply.code(400).send({ error: 'raw config is required' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      await client.configApply(raw, baseHash, { sessionKey, restartDelayMs });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply config';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/config/schema - Config JSON schema for form rendering
  fastify.get<{ Params: { id: string } }>('/:id/gateway/config/schema', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get config JSON schema',
      description: 'Returns the JSON schema for the OpenClaw configuration, useful for dynamic form rendering in the UI.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ schema: z.any() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const schema = await client.configSchema();
      return { schema };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get config schema';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Skills RPC Routes — manage skills on the running gateway
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/gateway/skills - Skills status from the running gateway
  fastify.get<{ Params: { id: string } }>('/:id/gateway/skills', {
    schema: {
      tags: ['Gateway'],
      summary: 'List gateway skills',
      description: 'Returns all skills and their status from the running OpenClaw gateway for the specified agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ skills: z.array(z.any()) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const skills = await client.skillsList();
      return { skills };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get skills';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/gateway/skills/:slug/install - Install a skill
  fastify.post<{ Params: { id: string; slug: string } }>(
    '/:id/gateway/skills/:slug/install',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Install a skill',
        description: 'Installs a skill by slug on the OpenClaw gateway for the specified agent.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          slug: z.string().describe('Skill slug identifier'),
        }),
        response: {
          201: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.skillsInstall(request.params.slug);
        return reply.code(201).send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to install skill';
        // OpenClaw: "Installer not found: clawhub:X" — entrypoint installs via CLI, treat as success
        const isExpected = /skill not found|UNAVAILABLE|not found|Installer not found/i.test(message);
        if (isExpected) return reply.code(201).send({ success: true });
        return reply.code(502).send({ error: message });
      }
    }
  );

  // PATCH /api/agents/:id/gateway/skills/:slug - Toggle or update a skill
  fastify.patch<{
    Params: { id: string; slug: string };
    Body: { enabled?: boolean; apiKey?: string; env?: Record<string, string> };
  }>('/:id/gateway/skills/:slug', {
    schema: {
      tags: ['Gateway'],
      summary: 'Toggle or update a skill',
      description: 'Updates a skill on the OpenClaw gateway. Can toggle enabled/disabled state, set an API key, or update environment variables.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        slug: z.string().describe('Skill slug identifier'),
      }),
      body: z.object({
        enabled: z.boolean().optional().describe('Enable or disable the skill'),
        apiKey: z.string().optional().describe('API key for the skill'),
        env: z.record(z.string()).optional().describe('Environment variables for the skill'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const { enabled, apiKey, env } = request.body;
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      if (enabled !== undefined) {
        await client.skillsToggle(request.params.slug, enabled);
      }
      if (apiKey !== undefined || env !== undefined) {
        await client.skillsUpdate(request.params.slug, { apiKey, env });
      }
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update skill';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Chat Abort Route
  // ═══════════════════════════════════════════════════════════════

  // POST /api/agents/:id/gateway/chat/abort - Abort a running agent turn
  fastify.post<{
    Params: { id: string };
    Body: { sessionKey: string };
  }>('/:id/gateway/chat/abort', {
    schema: {
      tags: ['Gateway'],
      summary: 'Abort a running agent turn',
      description: 'Aborts the currently running agent turn for a specific session on the OpenClaw gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        sessionKey: z.string().describe('Session key to abort'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const { sessionKey } = request.body;
    if (!sessionKey) {
      return reply.code(400).send({ error: 'sessionKey is required' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      await client.chatAbort(sessionKey);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to abort';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/gateway/devices/approve - Approve pending device pairing (Browser tool, etc.)
  fastify.post<{
    Params: { id: string };
  }>('/:id/gateway/devices/approve', {
    schema: {
      tags: ['Gateway'],
      summary: 'Approve pending device pairing',
      description: 'Approves pending device pairing requests in the OpenClaw container. Use when Browser tool or other in-container tools hit "pairing required".',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ success: z.literal(true), approved: z.number() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const filter: any = { _id: new ObjectId(agentId) };
    if (request.organizationId) filter.organizationId = request.organizationId;
    else filter.userId = request.userId;
    const agent = await agentsCollection.findOne(filter);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    if (agent.status !== 'running') {
      return reply.code(400).send({ error: 'Agent must be running to approve device pairing' });
    }
    if (!agent.gatewayToken) {
      return reply.code(400).send({ error: 'Agent not deployed or missing gateway info' });
    }
    try {
      const { approved } = await dockerService.approveDevicePairing(agentId, agent.gatewayToken);
      return { success: true, approved };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve device pairing';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/gateway/chat/inject - Inject assistant note
  fastify.post<{
    Params: { id: string };
    Body: { sessionKey: string; text: string };
  }>('/:id/gateway/chat/inject', {
    schema: {
      tags: ['Gateway'],
      summary: 'Inject assistant note into session',
      description: 'Injects an assistant note into a specific session on the OpenClaw gateway. Useful for adding context or instructions mid-conversation.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        sessionKey: z.string().describe('Target session key'),
        text: z.string().describe('Text to inject as assistant note'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    const { sessionKey, text } = request.body;
    if (!sessionKey || !text) {
      return reply.code(400).send({ error: 'sessionKey and text are required' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      await client.chatInject(sessionKey, text);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to inject';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // System / Models / Channels Status / Presence / Nodes
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/gateway/models - Available models from the running gateway
  fastify.get<{ Params: { id: string } }>('/:id/gateway/models', {
    schema: {
      tags: ['Gateway'],
      summary: 'List available models',
      description: 'Returns the list of available AI models configured on the OpenClaw gateway for the specified agent.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ models: z.array(z.any()) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const models = await client.modelsList();
      return { models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list models';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/status - Full gateway status snapshot
  fastify.get<{ Params: { id: string } }>('/:id/gateway/status', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get full gateway status',
      description: 'Returns a comprehensive status snapshot of the OpenClaw gateway, including agent state, channels, sessions, and system info.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ status: z.any() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const status = await client.getStatus();
      return { status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get status';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/channels/status - Channel connection status from gateway
  fastify.get<{ Params: { id: string } }>('/:id/gateway/channels/status', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get channel connection status',
      description: 'Returns the connection status of all configured channels (WhatsApp, Telegram, Discord, etc.) on the OpenClaw gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ channels: z.any() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const raw = await client.channelsStatus();
      // OpenClaw channels.status returns { channels: { whatsapp: { linked, configured, ... }, ... } }
      const rawChannels = raw?.channels ?? (Array.isArray(raw) ? undefined : raw);
      const channels = !rawChannels || typeof rawChannels !== 'object'
        ? []
        : Object.entries(rawChannels).map(([type, v]) => {
            const val = v as Record<string, unknown>;
            const connected = val?.connected === true
              || val?.status === 'connected'
              || val?.linked === true;
            const status = connected ? 'connected' : (val?.status as string) ?? (val?.linked === true ? 'connected' : 'pending');
            return {
              type,
              connected,
              status,
              error: val?.error,
            };
          });
      return { channels };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get channel status';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/presence - Connected clients/nodes
  fastify.get<{ Params: { id: string } }>('/:id/gateway/presence', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get connected clients and nodes',
      description: 'Returns the list of currently connected WebSocket clients and nodes on the OpenClaw gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ presence: z.any() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const presence = await client.getPresence();
      return { presence };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get presence';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/nodes - Connected nodes + capabilities
  fastify.get<{ Params: { id: string } }>('/:id/gateway/nodes', {
    schema: {
      tags: ['Gateway'],
      summary: 'List connected nodes',
      description: 'Returns all connected peripheral nodes and their capabilities (camera, screen, location, etc.) from the OpenClaw gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ nodes: z.array(z.any()) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const nodes = await client.nodeList();
      return { nodes };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list nodes';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/gateway/logs/tail - Live log tail from gateway
  fastify.get<{ Params: { id: string }; Querystring: { lines?: string; filter?: string } }>(
    '/:id/gateway/logs/tail',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Tail live gateway logs',
        description: 'Returns the most recent log lines from the OpenClaw gateway, with optional line count and filter string.',
        params: z.object({ id: z.string().describe('Agent ID') }),
        querystring: z.object({
          lines: z.string().optional().describe('Number of log lines to return (default: 100)'),
          filter: z.string().optional().describe('Filter string to match against log lines'),
        }),
        response: {
          200: z.object({ logs: z.any() }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        const lines = parseInt(request.query.lines || '100') || 100;
        const result = await client.logsTail({ lines, filter: request.query.filter });
        return { logs: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to tail logs';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Session Patch Route
  // ═══════════════════════════════════════════════════════════════

  // PATCH /api/agents/:id/gateway/sessions/:key - Patch session settings
  fastify.patch<{
    Params: { id: string; key: string };
    Body: Record<string, unknown>;
  }>('/:id/gateway/sessions/:key', {
    schema: {
      tags: ['Gateway'],
      summary: 'Patch session settings',
      description: 'Updates settings for a specific session on the OpenClaw gateway using a partial merge-patch.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        key: z.string().describe('Session key'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      await client.patchSession(request.params.key, request.body);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to patch session';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Usage & Cost Tracking
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/gateway/usage - Get usage stats (tokens, costs)
  fastify.get<{ Params: { id: string } }>('/:id/gateway/usage', {
    schema: {
      tags: ['Gateway'],
      summary: 'Get agent usage stats',
      description: 'Returns token usage and cost breakdown from the running OpenClaw gateway.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({ usage: z.any(), cost: z.any() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }
    try {
      const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
      const [usage, cost] = await Promise.all([
        client.usageStatus().catch(() => null),
        client.usageCost().catch(() => null),
      ]);
      return { usage, cost };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get usage data';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Session Management (reset, compact, delete)
  // ═══════════════════════════════════════════════════════════════

  // POST /api/agents/:id/gateway/sessions/:key/reset - Reset a session
  fastify.post<{ Params: { id: string; key: string } }>(
    '/:id/gateway/sessions/:key/reset',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Reset session',
        description: 'Resets a session, clearing its conversation history. Like /new in the chat.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          key: z.string().describe('Session key'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.sessionReset(request.params.key);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to reset session';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/gateway/sessions/:key/compact - Compact session context
  fastify.post<{ Params: { id: string; key: string } }>(
    '/:id/gateway/sessions/:key/compact',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Compact session',
        description: 'Compacts a session to free up context window space. Summarizes old messages.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          key: z.string().describe('Session key'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.sessionCompact(request.params.key);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to compact session';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // DELETE /api/agents/:id/gateway/sessions/:key - Delete a session
  fastify.delete<{ Params: { id: string; key: string } }>(
    '/:id/gateway/sessions/:key',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Delete session',
        description: 'Permanently deletes a session and all its history.',
        params: z.object({
          id: z.string().describe('Agent ID'),
          key: z.string().describe('Session key'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.sessionDelete(request.params.key);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete session';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Channel Logout
  // ═══════════════════════════════════════════════════════════════

  // POST /api/agents/:id/gateway/channels/:channel/logout - Disconnect a channel
  fastify.post<{ Params: { id: string; channel: string } }>(
    '/:id/gateway/channels/:channel/logout',
    {
      schema: {
        tags: ['Gateway'],
        summary: 'Logout from channel',
        description: 'Disconnects the agent from a specific channel (e.g. WhatsApp, Telegram).',
        params: z.object({
          id: z.string().describe('Agent ID'),
          channel: z.string().describe('Channel type (whatsapp, telegram, discord, etc.)'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }
      try {
        const { client } = await ensureConnection(agentId, request.userId, request.organizationId);
        await client.channelLogout(request.params.channel);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to logout from channel';
        return reply.code(502).send({ error: message });
      }
    }
  );
}
