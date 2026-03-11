import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import {
  analyticsResponseSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { usageService } from '../../services/usage.service.js';

export async function analyticsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();

  fastify.get('/', {
    schema: {
      tags: ['Analytics'],
      summary: 'Get organization analytics',
      description: 'Returns aggregate analytics across all agents including totals, 30-day timeseries for messages/costs/tokens, and per-agent performance breakdown.',
      response: {
        200: analyticsResponseSchema,
      },
    },
    preHandler: requirePermission('agents.view'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const agentFilter: any = organizationId ? { organizationId } : { userId };
    const agents = await db.collection('agents').find(agentFilter).toArray();
    
    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'running').length;
    const totalMessages = agents.reduce((sum, a) => sum + (a.metrics?.totalMessages || 0), 0);
    const totalCost = agents.reduce((sum, a) => sum + (a.metrics?.totalCost || 0), 0);
    const totalTokens = agents.reduce((sum, a) => sum + (a.metrics?.totalTokens || 0), 0);
    const totalInputTokens = agents.reduce((sum, a) => sum + (a.metrics?.totalInputTokens || 0), 0);
    const totalOutputTokens = agents.reduce((sum, a) => sum + (a.metrics?.totalOutputTokens || 0), 0);

    // Real timeseries data from messages collection
    const agentIds = agents.map(a => a._id!.toString());
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const messagesByDay = await db.collection('messages').aggregate([
      {
        $match: {
          agentId: { $in: agentIds },
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
        },
      },
    ]).toArray();

    const costByDay = await db.collection('messages').aggregate([
      {
        $match: {
          agentId: { $in: agentIds },
          createdAt: { $gte: thirtyDaysAgo },
          'metadata.cost': { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          cost: { $sum: '$metadata.cost' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          cost: 1,
        },
      },
    ]).toArray();

    // Token usage over time
    const tokensByDay = await db.collection('messages').aggregate([
      {
        $match: {
          agentId: { $in: agentIds },
          createdAt: { $gte: thirtyDaysAgo },
          'metadata.tokens': { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          tokens: { $sum: '$metadata.tokens' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          tokens: 1,
        },
      },
    ]).toArray();

    // Agent performance breakdown with tokens
    const agentPerformance = agents.map(a => ({
      agentId: a._id!.toString(),
      name: a.name,
      status: a.status,
      useCase: a.useCase,
      messages: a.metrics?.totalMessages || 0,
      cost: a.metrics?.totalCost || 0,
      tokens: a.metrics?.totalTokens || 0,
      lastActive: a.metrics?.lastActive?.toISOString?.() || a.updatedAt?.toISOString?.() || undefined,
    }));

    return {
      totalAgents,
      activeAgents,
      totalMessages,
      totalCost,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      messagesByDay,
      costByDay,
      tokensByDay,
      agentPerformance,
    };
  });

  // GET /api/analytics/usage - Detailed usage with model + agent breakdown
  fastify.get<{ Querystring: { from?: string; to?: string; agentId?: string } }>('/usage', {
    schema: {
      tags: ['Analytics'],
      summary: 'Get detailed usage analytics',
      description: 'Returns org-wide usage summary, per-model breakdown, per-agent breakdown, and daily timeseries.',
    },
    preHandler: requirePermission('analytics.view'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const { from, to, agentId } = request.query as any;
    const [summary, modelBreakdown, agentBreakdown, timeseries] = await Promise.all([
      usageService.getUsageSummary(organizationId, from, to, agentId),
      usageService.getModelBreakdown(organizationId, from, to, agentId),
      usageService.getAgentBreakdown(organizationId, agentId),
      usageService.getDailyTimeseries(organizationId, from, to, agentId),
    ]);

    return { summary, modelBreakdown, agentBreakdown, timeseries };
  });

  // GET /api/analytics/models - Per-model cost breakdown
  fastify.get<{ Querystring: { from?: string; to?: string; agentId?: string } }>('/models', {
    schema: {
      tags: ['Analytics'],
      summary: 'Get per-model cost breakdown',
      description: 'Returns cost, tokens, and message counts grouped by AI model.',
    },
    preHandler: requirePermission('analytics.view'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const { from, to, agentId } = request.query as any;
    return { models: await usageService.getModelBreakdown(organizationId, from, to, agentId) };
  });

  // GET /api/analytics/export - CSV/JSON export
  fastify.get<{ Querystring: { from: string; to: string; format?: string; agentId?: string } }>('/export', {
    schema: {
      tags: ['Analytics'],
      summary: 'Export usage analytics',
      description: 'Exports usage data as CSV or JSON. Includes summary, model breakdown, agent breakdown, and daily timeseries.',
    },
    preHandler: requirePermission('analytics.export'),
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    if (!organizationId) return reply.code(400).send({ error: 'No active organization' });

    const { from, to, format: fmt, agentId } = request.query as any;
    if (!from || !to) return reply.code(400).send({ error: 'from and to query params required' });

    const format = fmt === 'csv' ? 'csv' : 'json';
    const content = await usageService.exportUsage(organizationId, { from, to, format, agentId });

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = `usage-export-${from}-${to}.${format}`;

    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  });
}
