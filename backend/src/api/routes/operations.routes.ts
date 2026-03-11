import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import type { OperationsOverview, OperationsAlert, OperationsAgentStatus } from '@openclaw-business/shared';

// ── In-memory cache (per org/user, 5s TTL, max 500 entries) ───
const MAX_CACHE_ENTRIES = 500;
const overviewCache = new Map<string, { data: OperationsOverview; ts: number }>();
const CACHE_TTL_MS = 5_000;

function evictOldestIfNeeded(): void {
  if (overviewCache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of overviewCache) {
    if (v.ts < oldestTs) {
      oldestTs = v.ts;
      oldestKey = k;
    }
  }
  if (oldestKey) overviewCache.delete(oldestKey);
}

export async function operationsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const agentsCollection = db.collection('agents');
  const messagesCollection = db.collection('messages');

  // GET /api/operations/overview - Full operations dashboard data
  fastify.get('/overview', {
    schema: {
      tags: ['Operations'],
      summary: 'Get operations overview',
      description: 'Returns full operations dashboard data including agent counts, today\'s messages, alerts (errors and inactive agents), and per-agent status. Cached for 5 seconds per org.',
      response: {
        200: z.object({
          totalAgents: z.number(),
          activeAgents: z.number(),
          errorAgents: z.number(),
          totalMessagesToday: z.number(),
          totalTokens: z.number(),
          alerts: z.array(z.object({
            id: z.string(),
            agentId: z.string(),
            agentName: z.string(),
            type: z.enum(['error', 'warning']),
            message: z.string(),
            createdAt: z.string(),
          })),
          agents: z.array(z.object({
            agentId: z.string(),
            agentName: z.string(),
            status: z.string(),
            messages: z.number(),
            errors: z.number(),
            lastActive: z.string().optional(),
          })),
        }),
      },
    },
  }, async (request, reply) => {
    const organizationId = request.organizationId;
    const userId = request.userId;

    // Check cache (avoids 3 MongoDB queries on every 10s poll)
    const cacheKey = organizationId || userId || 'anon';
    const cached = overviewCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }

    // Support both org-based and user-based queries
    const filter: any = organizationId ? { organizationId } : { userId };

    // Get all agents (org-wide or user-wide)
    const agents = await agentsCollection.find(filter).toArray();

    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'running').length;
    const errorAgents = agents.filter(a => a.status === 'error').length;

    // Messages today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const agentIds = agents.map(a => a._id!.toString());

    const totalMessagesToday = await messagesCollection.countDocuments({
      agentId: { $in: agentIds },
      createdAt: { $gte: startOfDay },
    });

    // Total tokens across all agents
    const totalTokens = agents.reduce((sum, a) => sum + (a.metrics?.totalTokens ?? 0), 0);

    // Build alerts (createdAt serialised as ISO string for Zod response schema)
    const alerts: Array<Omit<OperationsAlert, 'createdAt'> & { createdAt: string }> = [];

    for (const agent of agents) {
      if (agent.status === 'error') {
        alerts.push({
          id: agent._id!.toString(),
          agentId: agent._id!.toString(),
          agentName: agent.name,
          type: 'error',
          message: agent.errorMessage || 'Agent needs attention — check configuration',
          createdAt: (agent.updatedAt ? new Date(agent.updatedAt) : new Date()).toISOString(),
        });
      }

      // Gateway disconnected recently (health degraded)
      if (agent.status === 'running' && agent.lastHealthEvent?.status === 'degraded') {
        const degradedAt = new Date(agent.lastHealthEvent.at).getTime();
        const minutesAgo = (Date.now() - degradedAt) / 60_000;
        if (minutesAgo < 30) {
          alerts.push({
            id: `degraded-${agent._id!.toString()}`,
            agentId: agent._id!.toString(),
            agentName: agent.name,
            type: 'warning',
            message: `Gateway connection lost ${Math.floor(minutesAgo)}m ago — reconnecting`,
            createdAt: new Date(agent.lastHealthEvent.at).toISOString(),
          });
        }
      }

      // Check for agents that haven't been active in 24h
      const lastActive = agent.metrics?.lastActive;
      if (agent.status === 'running' && lastActive) {
        const hoursSinceActive = (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60);
        if (hoursSinceActive > 24) {
          alerts.push({
            id: `inactive-${agent._id!.toString()}`,
            agentId: agent._id!.toString(),
            agentName: agent.name,
            type: 'warning',
            message: `Agent hasn't handled any conversations in ${Math.floor(hoursSinceActive)}h`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Sort alerts: errors first, then warnings
    alerts.sort((a, b) => {
      if (a.type === 'error' && b.type !== 'error') return -1;
      if (a.type !== 'error' && b.type === 'error') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Build agent status list (lastActive serialised as ISO string for Zod response schema)
    const agentStatuses: Array<Omit<OperationsAgentStatus, 'lastActive'> & { lastActive?: string }> = agents.map(agent => {
      const la = agent.metrics?.lastActive;
      return {
        agentId: agent._id!.toString(),
        agentName: agent.name,
        status: agent.status,
        messages: agent.metrics?.totalMessages || 0,
        errors: agent.status === 'error' ? 1 : 0,
        lastActive: la ? new Date(la).toISOString() : undefined,
      };
    });

    // Sort: errors first, then by messages descending
    agentStatuses.sort((a, b) => {
      if (a.status === 'error' && b.status !== 'error') return -1;
      if (a.status !== 'error' && b.status === 'error') return 1;
      return b.messages - a.messages;
    });

    const overview = {
      totalAgents,
      activeAgents,
      errorAgents,
      totalMessagesToday,
      totalTokens,
      alerts,
      agents: agentStatuses,
    };

    // Store in cache (evict oldest if over limit)
    evictOldestIfNeeded();
    overviewCache.set(cacheKey, { data: overview as unknown as OperationsOverview, ts: Date.now() });

    return overview;
  });
}
