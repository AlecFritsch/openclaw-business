// Internal Knowledge API — called by agent containers (havoc-knowledge plugin)
// Auth: X-Gateway-Token must match an agent's gatewayToken

import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { searchKnowledge } from '../../services/knowledge.service.js';

export async function internalKnowledgeRoutes(fastify: FastifyInstance) {

  // POST /api/internal/knowledge/search
  fastify.post<{ Body: { query: string; limit?: number; sourceIds?: string[] } }>('/knowledge/search', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const token = request.headers['x-gateway-token'] as string;
    if (!token) return reply.code(401).send({ error: 'X-Gateway-Token required' });

    const db = getDatabase();
    const agent = await db.collection('agents').findOne(
      { gatewayToken: token },
      { projection: { organizationId: 1, status: 1 } },
    );
    if (!agent) return reply.code(401).send({ error: 'Invalid gateway token' });

    const { query, limit, sourceIds } = request.body;
    if (!query) return reply.code(400).send({ error: 'query required' });

    const results = await searchKnowledge({
      organizationId: agent.organizationId,
      query,
      sourceIds,
      limit: limit || 5,
    });

    return { results };
  });
}
