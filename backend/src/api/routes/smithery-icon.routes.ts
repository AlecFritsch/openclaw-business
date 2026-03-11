// Public Icon Proxy — OHNE Auth, damit <img src="..."> funktioniert
// Siehe https://smithery.ai/docs/api-reference/servers/get-server-icon

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';

export async function smitheryIconRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { qualifiedName: string } }>('/servers/icon', {
    schema: {
      tags: ['Smithery'],
      summary: 'Get server icon (public)',
      description: 'Proxies the server icon from Smithery. No auth required for img tags.',
      querystring: z.object({ qualifiedName: z.string().min(1) }),
    },
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!config.smitheryApiKey) {
      return reply.code(503).send({ error: 'Smithery not configured' });
    }
    const { qualifiedName } = request.query;
    try {
      const encoded = encodeURIComponent(qualifiedName);
      const iconRes = await fetch(`https://api.smithery.ai/servers/${encoded}/icon`, {
        headers: { Authorization: `Bearer ${config.smitheryApiKey}` },
      });
      if (!iconRes.ok) return reply.code(404).send({ error: 'Icon not found' });
      const contentType = iconRes.headers.get('content-type') || 'image/png';
      const buffer = await iconRes.arrayBuffer();
      return reply.type(contentType).send(Buffer.from(buffer));
    } catch {
      return reply.code(404).send({ error: 'Icon not found' });
    }
  });
}
