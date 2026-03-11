import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { validateObjectId } from '../../validation/schemas.js';
import { z } from 'zod';
import type { ActivityEvent } from '@openclaw-business/shared';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  activityEventSchema,
  listActivityResponseSchema,
  errorResponseSchema,
} from '../../validation/response-schemas.js';

const createActivitySchema = z.object({
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  metadata: z.record(z.any()).optional(),
});

export async function activityRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const activityCollection = db.collection<ActivityEvent>('activity');

  // GET /api/activity - Get activity feed
  fastify.get('/', {
    schema: {
      tags: ['Activity'],
      summary: 'Get activity feed',
      description: 'Returns a paginated feed of activity events for the current user or organization, filterable by agent or event type.',
      querystring: z.object({
        agentId: z.string().optional(),
        type: z.string().optional(),
        limit: z.coerce.number().min(1).max(1000).default(50).optional(),
        offset: z.coerce.number().min(0).default(0).optional(),
      }),
      response: {
        200: listActivityResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const { agentId, type, limit = 50, offset = 0 } = request.query as any;

    const filter: any = organizationId ? { organizationId } : { userId };
    if (agentId) filter.agentId = agentId;
    if (type) filter.type = type;

    const rawEvents = await activityCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 50)
      .skip(Number(offset) || 0)
      .toArray();

    const total = await activityCollection.countDocuments(filter);

    // Convert MongoDB types to serializable strings
    const events = rawEvents.map((e) => ({
      _id: e._id!.toString(),
      type: e.type,
      title: e.title,
      description: e.description || '',
      agentId: e.agentId,
      metadata: e.metadata,
      createdAt: new Date(e.createdAt).toISOString(),
    }));

    return { events, total };
  });

  // POST /api/activity - Create activity event (internal use)
  fastify.post('/', {
    schema: {
      tags: ['Activity'],
      summary: 'Create an activity event',
      description: 'Records a new activity event. Intended for internal use by agent containers and backend services.',
      body: createActivitySchema,
      response: {
        201: z.object({ event: activityEventSchema }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const validation = createActivitySchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Validation failed', details: validation.error.errors });
    }

    const body = validation.data;

    // Validate ObjectIds if provided
    if (body.agentId && !validateObjectId(body.agentId)) {
      return reply.code(400).send({ error: 'Invalid agentId format' });
    }

    const event: ActivityEvent = {
      userId,
      organizationId,
      agentId: body.agentId,
      sessionId: body.sessionId,
      type: body.type as any,
      title: body.title,
      description: body.description || '',
      metadata: body.metadata,
      createdAt: new Date(),
    };

    const result = await activityCollection.insertOne(event as any);

    return reply.code(201).send({ event: serializeDoc({ ...event, _id: result.insertedId.toString() }) });
  });
}
