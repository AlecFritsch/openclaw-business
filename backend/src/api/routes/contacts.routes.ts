// Contacts Routes - Omnichannel contact management

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contactsService } from '../../services/contacts.service.js';
import {
  successResponseSchema,
  errorResponseSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

export async function contactsRoutes(fastify: FastifyInstance) {
  // Trial guard: block mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }
  });

  // GET /api/contacts - List contacts
  fastify.get<{
    Querystring: { search?: string; tag?: string; channel?: string; limit?: string; offset?: string };
  }>('/', {
    schema: {
      tags: ['Contacts'],
      summary: 'List contacts',
      description: 'Lists all contacts for the organization with optional search and filtering.',
      querystring: z.object({
        search: z.string().optional(),
        tag: z.string().optional(),
        channel: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
      response: {
        200: z.object({
          contacts: z.array(z.any()),
          total: z.number(),
        }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!request.organizationId) {
      return reply.code(400).send({ error: 'Organization required' });
    }

    const result = await contactsService.listContacts(request.organizationId, {
      search: request.query.search,
      tag: request.query.tag,
      channel: request.query.channel,
      limit: request.query.limit ? parseInt(request.query.limit) : undefined,
      offset: request.query.offset ? parseInt(request.query.offset) : undefined,
    });
    return result;
  });

  // GET /api/contacts/:id - Get contact detail
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Contacts'],
      summary: 'Get contact',
      description: 'Get details of a specific contact.',
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ contact: z.any() }),
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (!request.organizationId) {
      return reply.code(400).send({ error: 'Organization required' });
    }

    const contact = await contactsService.getContact(request.params.id, request.organizationId);
    if (!contact) {
      return reply.code(404).send({ error: 'Contact not found' });
    }
    return { contact };
  });

  // PUT /api/contacts/:id - Update contact
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; tags?: string[]; notes?: string };
  }>('/:id', {
    schema: {
      tags: ['Contacts'],
      summary: 'Update contact',
      description: 'Update a contact\'s name, tags, or notes.',
      params: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
      response: {
        200: z.object({ contact: z.any() }),
        404: errorResponseSchema,
      },
    },
    preHandler: requirePermission('contacts.manage'),
  }, async (request, reply) => {
    if (!request.organizationId) {
      return reply.code(400).send({ error: 'Organization required' });
    }

    const contact = await contactsService.updateContact(
      request.params.id,
      request.organizationId,
      request.body
    );
    if (!contact) {
      return reply.code(404).send({ error: 'Contact not found' });
    }
    return { contact };
  });

  // POST /api/contacts/:targetId/merge/:sourceId - Merge contacts
  fastify.post<{
    Params: { targetId: string; sourceId: string };
  }>('/:targetId/merge/:sourceId', {
    schema: {
      tags: ['Contacts'],
      summary: 'Merge contacts',
      description: 'Merge two contacts into one (cross-channel dedup). Source channels are added to target.',
      params: z.object({
        targetId: z.string(),
        sourceId: z.string(),
      }),
      response: {
        200: z.object({ contact: z.any() }),
        400: errorResponseSchema,
      },
    },
    preHandler: requirePermission('contacts.manage'),
  }, async (request, reply) => {
    if (!request.organizationId) {
      return reply.code(400).send({ error: 'Organization required' });
    }

    try {
      const contact = await contactsService.mergeContacts(
        request.params.targetId,
        request.params.sourceId,
        request.organizationId
      );
      return { contact };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to merge contacts';
      return reply.code(400).send({ error: message });
    }
  });

  // DELETE /api/contacts/:id - Delete contact
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Contacts'],
      summary: 'Delete contact',
      params: z.object({ id: z.string() }),
      response: {
        200: successResponseSchema,
        404: errorResponseSchema,
      },
    },
    preHandler: requirePermission('contacts.manage'),
  }, async (request, reply) => {
    if (!request.organizationId) {
      return reply.code(400).send({ error: 'Organization required' });
    }

    const deleted = await contactsService.deleteContact(request.params.id, request.organizationId);
    if (!deleted) {
      return reply.code(404).send({ error: 'Contact not found' });
    }
    return { success: true };
  });
}
