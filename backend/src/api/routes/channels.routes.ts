import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import type { Channel, CreateChannelRequest, UpdateChannelRequest } from '@openclaw-business/shared';
import { createChannelSchema, updateChannelSchema, validateObjectId } from '../../validation/schemas.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { encrypt } from '../../utils/encryption.js';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  listChannelsResponseSchema,
  channelResponseSchema,
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';

export async function channelsRoutes(fastify: FastifyInstance) {
  // Trial guard: block mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }
  });

  const db = getDatabase();
  const channelsCollection = db.collection<Channel>('channels');

  // GET /api/channels - List all channels
  fastify.get('/', {
    schema: {
      tags: ['Channels'],
      summary: 'List channels',
      description: 'Returns all channels, optionally filtered by agentId, type, or status. Credentials are masked.',
      querystring: z.object({
        agentId: z.string().optional(),
        type: z.string().optional(),
        status: z.enum(['connected', 'disconnected', 'error']).optional(),
      }),
      response: { 200: listChannelsResponseSchema },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    const { agentId, type, status } = request.query as any;

    const filter: any = organizationId ? { organizationId } : { userId };
    if (agentId) filter.agentId = agentId;
    if (type) filter.type = type;
    if (status) filter.status = status;

    const channels = await channelsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    // Remove encrypted credentials from response
    const sanitized = channels.map(ch => {
      const { credentials, ...rest } = ch;
      return { ...rest, credentials: { encrypted: true } };
    });

    return { channels: sanitized.map(serializeDoc) };
  });

  // Helper: ownership filter for channel queries
  function channelOwnerFilter(request: any, channelId?: string) {
    const filter: any = {};
    if (channelId) filter._id = new ObjectId(channelId) as any;
    if (request.organizationId) {
      filter.organizationId = request.organizationId;
    } else {
      filter.userId = request.userId;
    }
    return filter;
  }

  // POST /api/channels - Create new channel
  fastify.post<{ Body: CreateChannelRequest }>('/', {
    schema: {
      tags: ['Channels'],
      summary: 'Create channel',
      description: 'Creates a new channel connection. Credentials are AES-256-GCM encrypted at rest.',
      body: createChannelSchema,
      response: {
        201: z.object({ channel: channelResponseSchema }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;
    const organizationId = request.organizationId;

    // Validate request body
    const validation = createChannelSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const { type, name, credentials, config } = validation.data;

    const channel: Channel = {
      userId,
      organizationId,
      type,
      name,
      status: 'disconnected',
      credentials: {
        encrypted: encrypt(JSON.stringify(credentials)),
      },
      config: config || {},
      metrics: {
        totalMessages: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await channelsCollection.insertOne(channel as any);
    
    const { credentials: _, ...sanitized } = channel;
    
    return reply.code(201).send({ 
      channel: serializeDoc({ ...sanitized, _id: result.insertedId.toString(), credentials: { encrypted: true } }) 
    });
  });

  // GET /api/channels/:id - Get channel details
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Channels'],
      summary: 'Get channel by ID',
      description: 'Returns channel details with masked credentials.',
      params: z.object({ id: z.string().describe('Channel ID') }),
      response: {
        200: z.object({ channel: channelResponseSchema }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    // Validate ObjectId
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid channel ID format' });
    }

    const channel = await channelsCollection.findOne(channelOwnerFilter(request, request.params.id));

    if (!channel) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    const { credentials, ...sanitized } = channel;
    
    return { channel: serializeDoc({ ...sanitized, credentials: { encrypted: true } }) };
  });

  // PATCH /api/channels/:id - Update channel
  fastify.patch<{ Params: { id: string }; Body: UpdateChannelRequest }>('/:id', {
    schema: {
      tags: ['Channels'],
      summary: 'Update channel',
      description: 'Updates channel name, status, or config.',
      params: z.object({ id: z.string().describe('Channel ID') }),
      body: updateChannelSchema,
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    // Validate ObjectId
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid channel ID format' });
    }

    // Validate request body
    const validation = updateChannelSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const updates: any = { updatedAt: new Date() };
    
    if (validation.data.name) updates.name = validation.data.name;
    if (validation.data.status) updates.status = validation.data.status;
    if (validation.data.config) updates.config = validation.data.config;

    const result = await channelsCollection.updateOne(
      channelOwnerFilter(request, request.params.id),
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    return { success: true };
  });

  // DELETE /api/channels/:id - Delete channel
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Channels'],
      summary: 'Delete channel',
      description: 'Permanently deletes a channel connection.',
      params: z.object({ id: z.string().describe('Channel ID') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    // Validate ObjectId
    if (!validateObjectId(request.params.id)) {
      return reply.code(400).send({ error: 'Invalid channel ID format' });
    }

    const result = await channelsCollection.deleteOne(
      channelOwnerFilter(request, request.params.id)
    );

    if (result.deletedCount === 0) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    return { success: true };
  });
}
