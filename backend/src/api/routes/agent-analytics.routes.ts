import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';
import {
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';

export async function agentAnalyticsRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const sessionsCollection = db.collection('sessions');
  const messagesCollection = db.collection('messages');
  const logsCollection = db.collection('logs');

  // GET /api/agents/:id/analytics - Get agent-specific analytics
  fastify.get<{ Params: { id: string } }>('/:id/analytics', {
    schema: {
      tags: ['Agent Analytics'],
      summary: 'Get agent-specific analytics',
      description: 'Returns detailed analytics for a single agent including session counts, message totals, error counts, and 7-day timeseries breakdowns for messages and sessions.',
      params: z.object({
        id: z.string().describe('Agent ID'),
      }),
      response: {
        200: z.object({
          analytics: z.object({
            totalSessions: z.number(),
            activeSessions: z.number(),
            totalMessages: z.number(),
            errorCount: z.number(),
            messagesByDay: z.array(z.object({ date: z.string(), count: z.number() })),
            sessionsByDay: z.array(z.object({ date: z.string(), count: z.number() })),
          }),
        }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    // Verify agent belongs to user/org
    const organizationId = request.organizationId;
    const filter: any = { _id: new ObjectId(agentId) as any };
    if (organizationId) {
      filter.organizationId = organizationId;
    } else {
      filter.userId = userId;
    }
    const agent = await db.collection('agents').findOne(filter);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Get sessions count
    const totalSessions = await sessionsCollection.countDocuments({ agentId });
    const activeSessions = await sessionsCollection.countDocuments({ 
      agentId, 
      status: 'active' 
    });

    // Get messages count
    const totalMessages = await messagesCollection.countDocuments({ agentId });

    // Get error logs count
    const errorCount = await logsCollection.countDocuments({ 
      agentId, 
      level: 'error' 
    });

    // Get messages by day (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const messagesByDay = await messagesCollection.aggregate([
      {
        $match: {
          agentId,
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    // Get sessions by day (last 7 days)
    const sessionsByDay = await sessionsCollection.aggregate([
      {
        $match: {
          agentId,
          startedAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    return {
      analytics: {
        totalSessions,
        activeSessions,
        totalMessages,
        errorCount,
        messagesByDay: messagesByDay.map(d => ({ date: d._id, count: d.count })),
        sessionsByDay: sessionsByDay.map(d => ({ date: d._id, count: d.count })),
      }
    };
  });
}
