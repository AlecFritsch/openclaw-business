import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import type { SupportTicket, CreateSupportTicketRequest } from '@openclaw-business/shared';
import { validateObjectId } from '../../validation/schemas.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  supportTicketResponseSchema,
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';

const createTicketSchema = z.object({
  subject: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

const addMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

export async function supportRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const ticketsCollection = db.collection<SupportTicket>('support_tickets');

  // GET /api/support/tickets - List tickets
  fastify.get('/tickets', {
    schema: {
      tags: ['Support'],
      summary: 'List support tickets',
      description: 'Returns support tickets for the current user or organization, with optional status filter and pagination.',
      querystring: z.object({
        status: z.string().optional(),
        limit: z.coerce.number().min(1).max(1000).default(50).optional(),
        offset: z.coerce.number().min(0).default(0).optional(),
      }),
      response: {
        200: z.object({ tickets: z.array(supportTicketResponseSchema), total: z.number() }),
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const { status, limit = 50, offset = 0 } = request.query as any;

    const filter: any = organizationId ? { organizationId } : { userId };
    if (status) filter.status = status;

    const tickets = await ticketsCollection
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(Number(limit))
      .skip(Number(offset))
      .toArray();

    const total = await ticketsCollection.countDocuments(filter);

    return { tickets: tickets.map(serializeDoc), total };
  });

  // POST /api/support/tickets - Create ticket
  fastify.post<{ Body: CreateSupportTicketRequest }>('/tickets', {
    schema: {
      tags: ['Support'],
      summary: 'Create a support ticket',
      description: 'Opens a new support ticket with a subject, description, and optional priority. The description is also stored as the first message.',
      body: createTicketSchema,
      response: {
        201: z.object({ ticket: supportTicketResponseSchema }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const validation = createTicketSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Validation failed', details: validation.error.errors });
    }

    const data = validation.data;

    const ticket: SupportTicket = {
      userId,
      organizationId,
      subject: data.subject,
      description: data.description,
      status: 'open',
      priority: data.priority || 'medium',
      messages: [
        {
          id: randomUUID(),
          userId,
          content: data.description,
          isAgent: false,
          createdAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await ticketsCollection.insertOne(ticket as any);

    return reply.code(201).send({ ticket: serializeDoc({ ...ticket, _id: result.insertedId.toString() }) });
  });

  // GET /api/support/tickets/:id - Get ticket detail
  fastify.get<{ Params: { id: string } }>('/tickets/:id', {
    schema: {
      tags: ['Support'],
      summary: 'Get ticket detail',
      description: 'Returns full details of a support ticket including all messages by its ID.',
      params: z.object({
        id: z.string().describe('Ticket ID'),
      }),
      response: {
        200: z.object({ ticket: supportTicketResponseSchema }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid ticket ID format' });
    }

    // Build filter with auth: user can only see their own tickets or their org's tickets
    const authFilter: any = organizationId ? { organizationId } : { userId };

    const ticket = await ticketsCollection.findOne({
      _id: new ObjectId(request.params.id) as any,
      ...authFilter,
    });

    if (!ticket) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    return { ticket: serializeDoc(ticket) };
  });

  // POST /api/support/tickets/:id/messages - Add message to ticket
  fastify.post<{ Params: { id: string } }>('/tickets/:id/messages', {
    schema: {
      tags: ['Support'],
      summary: 'Add message to ticket',
      description: 'Appends a new message to an existing support ticket thread.',
      params: z.object({
        id: z.string().describe('Ticket ID'),
      }),
      body: addMessageSchema,
      response: {
        200: z.object({
          message: z.object({
            id: z.string(),
            userId: z.string(),
            content: z.string(),
            isAgent: z.boolean(),
            createdAt: z.string(),
          }),
        }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid ticket ID format' });
    }

    const validation = addMessageSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Validation failed', details: validation.error.errors });
    }

    const { content } = validation.data;
    const { isAgent } = request.body as any;

    const message = {
      id: randomUUID(),
      userId,
      content,
      isAgent: isAgent || false,
      createdAt: new Date(),
    };

    const authFilter: any = organizationId ? { organizationId } : { userId };
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(request.params.id) as any, ...authFilter },
      {
        $push: { messages: message as any },
        $set: { updatedAt: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    return { message: serializeDoc(message) };
  });

  // PATCH /api/support/tickets/:id - Update ticket status
  fastify.patch<{ Params: { id: string } }>('/tickets/:id', {
    schema: {
      tags: ['Support'],
      summary: 'Update ticket status',
      description: 'Updates the status and/or priority of an existing support ticket.',
      params: z.object({
        id: z.string().describe('Ticket ID'),
      }),
      body: z.object({
        status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    // Trial guard on ticket status changes (ticket creation + messages remain allowed)
    if (request.trialExpired) {
      return reply.code(403).send({ error: 'Payment required. Upgrade to Professional to continue.' });
    }

    const userId = request.userId;
    const organizationId = request.organizationId;
    const body = request.body as any;

    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid ticket ID format' });
    }

    const updateData: any = { updatedAt: new Date() };
    if (body.status) updateData.status = body.status;
    if (body.priority) updateData.priority = body.priority;

    const authFilter: any = organizationId ? { organizationId } : { userId };
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(request.params.id) as any, ...authFilter },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    return { success: true };
  });
}
