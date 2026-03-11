import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import type { Log, LogQuery } from '@openclaw-business/shared';
import { createLogSchema, logQuerySchema } from '../../validation/schemas.js';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  listLogsResponseSchema,
  successResponseSchema,
  errorResponseSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

export async function logsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const logsCollection = db.collection<Log>('logs');

  fastify.get('/', {
    schema: {
      tags: ['Logs'],
      summary: 'Query logs',
      description: 'Returns log entries for the current user or organization, filterable by agent, session, level, and date range with pagination.',
      querystring: logQuerySchema,
      response: {
        200: listLogsResponseSchema,
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.view'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Validate query parameters
    const validation = logQuerySchema.safeParse(request.query);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: validation.error.errors });
    }

    const { 
      agentId, 
      sessionId, 
      level, 
      startDate, 
      endDate, 
      limit = 100, 
      offset = 0 
    } = validation.data;

    const filter: any = organizationId ? { organizationId } : { userId };
    if (agentId) filter.agentId = agentId;
    if (sessionId) filter.sessionId = sessionId;
    if (level) filter.level = level;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const logs = await logsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 100)
      .skip(Number(offset) || 0)
      .toArray();

    const total = await logsCollection.countDocuments(filter);

    return { logs: logs.map(serializeDoc), total };
  });

  // POST /api/logs - Create log entry (internal use)
  fastify.post('/', {
    schema: {
      tags: ['Logs'],
      summary: 'Create a log entry',
      description: 'Inserts a new log entry. Intended for internal use by agent containers and backend services.',
      body: createLogSchema,
      response: {
        201: successResponseSchema,
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.view'),
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Validate request body
    const validation = createLogSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const log: Log = {
      ...validation.data,
      userId,
      organizationId,
      createdAt: new Date(),
    };

    await logsCollection.insertOne(log as any);

    return reply.code(201).send({ success: true });
  });
}

