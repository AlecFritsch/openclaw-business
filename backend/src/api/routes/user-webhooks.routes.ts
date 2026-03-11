import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';
import { serializeDoc } from '../../utils/sanitize.js';
import { z } from 'zod';
import {
  webhookResponseSchema,
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';

export async function userWebhooksRoutes(fastify: FastifyInstance) {
  // Trial guard: block mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }
  });

  const db = getDatabase();
  const webhooksCollection = db.collection('webhooks');

  // GET /api/webhooks - List user webhooks
  fastify.get('/', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List user webhooks',
      description: 'Returns all webhooks owned by the current user, optionally filtered by agent.',
      querystring: z.object({
        agentId: z.string().optional(),
      }),
      response: {
        200: z.object({ webhooks: z.array(webhookResponseSchema) }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const { agentId } = request.query as any;

    const filter: any = { userId };
    if (agentId) filter.agentId = agentId;

    const webhooks = await webhooksCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return { webhooks: webhooks.map(serializeDoc) };
  });

  // POST /api/webhooks - Create webhook
  fastify.post('/', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Create a webhook',
      description: 'Registers a new HTTPS webhook endpoint that will receive the specified events.',
      body: z.object({
        url: z.string().url(),
        events: z.array(z.string()).min(1),
        agentId: z.string().optional(),
      }),
      response: {
        201: z.object({ webhook: webhookResponseSchema }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const { url, events, agentId } = request.body as any;

    if (!url || !events || events.length === 0) {
      return reply.code(400).send({ error: 'URL and events are required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return reply.code(400).send({ error: 'Invalid URL format' });
    }

    // Validate URL protocol (only https allowed for security)
    if (!url.startsWith('https://')) {
      return reply.code(400).send({ error: 'Webhook URL must use HTTPS' });
    }

    const webhook = {
      userId,
      agentId: agentId || null,
      url,
      events,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await webhooksCollection.insertOne(webhook as any);

    return reply.code(201).send({
      webhook: serializeDoc({ ...webhook, _id: result.insertedId.toString() }),
    });
  });

  // DELETE /api/webhooks/:id - Delete webhook
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Delete a webhook',
      description: 'Permanently removes a webhook by its ID. Only the owning user can delete it.',
      params: z.object({
        id: z.string().describe('Webhook ID'),
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
      return reply.code(400).send({ error: 'Invalid webhook ID format' });
    }

    const result = await webhooksCollection.deleteOne({
      _id: new ObjectId(request.params.id) as any,
      userId,
    });

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'Webhook not found' });
    }

    return { success: true };
  });
}
