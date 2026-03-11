import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../../config/database.js';
import type { User } from '@openclaw-business/shared';
import { updateUserSchema, createApiKeySchema } from '../../validation/schemas.js';
import crypto from 'crypto';
import { serializeDoc } from '../../utils/sanitize.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  userResponseSchema,
  apiKeySchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

export async function usersRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const usersCollection = db.collection<User>('users');

  // GET /api/users/me - Get current user
  fastify.get('/me', {
    schema: {
      tags: ['Users'],
      summary: 'Get current user',
      description: 'Returns the full profile of the currently authenticated user.',
      response: {
        200: z.object({ user: userResponseSchema }),
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;

    const user = await usersCollection.findOne({ clerkId: userId });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Ensure all required fields have safe defaults for serialization
    const safeUser = {
      ...user,
      settings: user.settings || { notifications: true, theme: 'system', language: 'en' },
      subscription: user.subscription || { plan: 'unpaid', status: 'active' },
      apiKeys: user.apiKeys || [],
    };

    return { user: serializeDoc(safeUser) };
  });

  // PATCH /api/users/me - Update current user
  fastify.patch('/me', {
    schema: {
      tags: ['Users'],
      summary: 'Update current user',
      description: 'Updates the currently authenticated user\'s settings (notifications, theme, language).',
      body: updateUserSchema,
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;

    // Validate request body
    const validation = updateUserSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const { settings } = validation.data;

    const updates: any = { updatedAt: new Date() };
    if (settings) updates.settings = settings;

    await usersCollection.updateOne(
      { clerkId: userId },
      { $set: updates }
    );

    return { success: true };
  });

  // GET /api/users/me/api-keys - List API keys
  fastify.get('/me/api-keys', {
    schema: {
      tags: ['Users'],
      summary: 'List API keys',
      description: 'Returns all API keys for the current user. Keys are masked — only the first 8 and last 4 characters are visible.',
      response: {
        200: z.object({ apiKeys: z.array(apiKeySchema) }),
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const userId = request.userId;

    const user = await usersCollection.findOne({ clerkId: userId });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    // Hide actual keys, only show metadata
    const keys = (user.apiKeys || []).map(k => ({
      id: k.id,
      name: k.name,
      key: `${k.key.slice(0, 8)}...${k.key.slice(-4)}`,
      createdAt: k.createdAt,
      lastUsed: k.lastUsed,
    }));

    return { apiKeys: keys.map(serializeDoc) };
  });

  // POST /api/users/me/api-keys - Create API key
  fastify.post('/me/api-keys', {
    schema: {
      tags: ['Users'],
      summary: 'Create API key',
      description: 'Generates a new API key with the given name. The full key is returned only once in the response.',
      body: createApiKeySchema,
      response: {
        201: z.object({
          apiKey: z.object({
            id: z.string(),
            name: z.string(),
            key: z.string().describe('Full API key — only returned at creation time'),
            createdAt: z.string(),
          }),
        }),
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('api_keys.manage'),
  }, async (request, reply) => {
    const userId = request.userId;

    // Validate request body
    const validation = createApiKeySchema.safeParse(request.body);
    if (!validation.success) {
      return reply.code(400).send({ error: 'Invalid request', details: validation.error.errors });
    }

    const { name } = validation.data;

    const apiKey = {
      id: crypto.randomUUID(),
      name,
      key: `agx_${crypto.randomBytes(32).toString('hex')}`,
      createdAt: new Date(),
    };

    await usersCollection.updateOne(
      { clerkId: userId },
      { $push: { apiKeys: apiKey } as any }
    );

    if (request.audit) {
      await request.audit({
        category: 'security.access',
        action: 'security.api_key_created',
        title: `API Key "${name}" erstellt`,
        description: `Neuer API Key "${name}" erstellt (agx_****${apiKey.key.slice(-4)}). Erlaubt programmatischen Zugriff auf alle API-Endpunkte.`,
        reasoning: 'Benutzer hat einen neuen API Key für programmatischen Zugriff generiert',
        riskLevel: 'high',
        outcome: 'success',
        resource: { type: 'api_key', id: apiKey.id, name },
        metadata: { keyPrefix: apiKey.key.slice(0, 8) },
      });
    }

    return reply.code(201).send({ apiKey: serializeDoc(apiKey) });
  });

  // DELETE /api/users/me/api-keys/:id - Delete API key
  fastify.delete<{ Params: { id: string } }>('/me/api-keys/:id', {
    schema: {
      tags: ['Users'],
      summary: 'Delete API key',
      description: 'Permanently deletes an API key by its ID. This action cannot be undone.',
      params: z.object({
        id: z.string().describe('API key ID'),
      }),
      response: {
        200: successResponseSchema,
      },
    },
    preHandler: requirePermission('api_keys.manage'),
  }, async (request, reply) => {
    const userId = request.userId;

    await usersCollection.updateOne(
      { clerkId: userId },
      { $pull: { apiKeys: { id: request.params.id } } as any }
    );

    if (request.audit) {
      await request.audit({
        category: 'security.access',
        action: 'security.api_key_revoked',
        title: `API Key widerrufen`,
        description: `API Key mit ID ${request.params.id} permanent gelöscht. Alle Anwendungen die diesen Key nutzen verlieren sofort den Zugriff.`,
        reasoning: 'Benutzer hat einen API Key widerrufen',
        riskLevel: 'high',
        outcome: 'success',
        resource: { type: 'api_key', id: request.params.id },
      });
    }

    return { success: true };
  });
}
