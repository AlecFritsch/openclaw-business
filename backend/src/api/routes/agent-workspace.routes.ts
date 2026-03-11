// Agent Workspace Routes - Read/write workspace files (persona, memory)
// Uses OpenClaw Tools Invoke HTTP API via workspace.service

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateObjectId } from '../../validation/schemas.js';
import { workspaceService, PERSONA_FILES } from '../../services/workspace.service.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
  objectIdSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { parseDocument, isSupportedFormat, getSupportedFormats } from '../../services/document-parser.service.js';

export async function agentWorkspaceRoutes(fastify: FastifyInstance) {
  // Rate limit mutations (POST/PUT/PATCH/DELETE): 60/min
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method !== 'GET' && !routeOptions.config?.rateLimit) {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 60, timeWindow: '1 minute' } };
    }
  });

  // ── Trial guard: block mutations when trial has expired ──────────
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your 7-day trial has expired. Upgrade to Professional to continue.',
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Persona Files (SOUL.md, AGENTS.md, IDENTITY.md, etc.)
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/workspace/persona - Get all persona files
  fastify.get<{ Params: { id: string } }>('/:id/workspace/persona', {
    schema: {
      tags: ['Workspace'],
      summary: 'Get all persona files',
      description: 'Returns all persona files (SOUL.md, AGENTS.md, IDENTITY.md, USER.md, etc.) for an agent workspace.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      response: {
        200: z.object({ files: z.array(z.object({ name: z.string(), content: z.string() })) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const files = await workspaceService.getPersonaFiles(
        agentId, request.userId, request.organizationId
      );
      return { files };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get persona files';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/workspace/file/:filename - Read a specific workspace file
  fastify.get<{ Params: { id: string; filename: string } }>(
    '/:id/workspace/file/:filename',
    {
      schema: {
        tags: ['Workspace'],
        summary: 'Read a workspace file',
        description: 'Reads a specific workspace file by filename (e.g. SOUL.md, AGENTS.md, IDENTITY.md).',
        params: z.object({
          id: objectIdSchema.describe('Agent ID'),
          filename: z.string().describe('Workspace filename (e.g. SOUL.md, AGENTS.md)'),
        }),
        response: {
          200: z.object({ file: z.object({ name: z.string(), content: z.string() }) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const file = await workspaceService.readFile(
          agentId, request.userId, request.params.filename, request.organizationId
        );
        return { file };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read file';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // PUT /api/agents/:id/workspace/file/:filename - Write a workspace file
  fastify.put<{
    Params: { id: string; filename: string };
    Body: { content: string };
  }>('/:id/workspace/file/:filename', {
    schema: {
      tags: ['Workspace'],
      summary: 'Write a workspace file',
      description: 'Creates or overwrites a workspace file with the provided content.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        filename: z.string().describe('Workspace filename (e.g. SOUL.md, AGENTS.md)'),
      }),
      body: z.object({ content: z.string().describe('File content to write') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { content } = request.body;
    if (content === undefined || content === null) {
      return reply.code(400).send({ error: 'content is required' });
    }

    try {
      const versionNumber = await workspaceService.writeFile(
        agentId, request.userId, request.params.filename, content, request.organizationId
      );
      return { success: true, version: versionNumber };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to write file';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // File Version History
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/workspace/file/:filename/versions - List versions
  fastify.get<{
    Params: { id: string; filename: string };
    Querystring: { limit?: string; skip?: string };
  }>('/:id/workspace/file/:filename/versions', {
    schema: {
      tags: ['Workspace'],
      summary: 'List file versions',
      description: 'Returns the version history for a workspace file.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        filename: z.string().describe('Workspace filename'),
      }),
      querystring: z.object({
        limit: z.string().optional(),
        skip: z.string().optional(),
      }),
      response: {
        200: z.object({
          versions: z.array(z.object({
            version: z.number(),
            userId: z.string(),
            createdAt: z.any(),
            contentLength: z.number(),
            action: z.string(),
          })),
          total: z.number(),
          filename: z.string(),
        }),
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);
      const skip = parseInt(request.query.skip || '0', 10);

      const result = await workspaceService.getVersions(
        agentId, request.params.filename, limit, skip
      );

      return { ...result, filename: request.params.filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get versions';
      return reply.code(400).send({ error: message });
    }
  });

  // GET /api/agents/:id/workspace/file/:filename/versions/:version - Get specific version
  fastify.get<{
    Params: { id: string; filename: string; version: string };
  }>('/:id/workspace/file/:filename/versions/:version', {
    schema: {
      tags: ['Workspace'],
      summary: 'Get a specific file version',
      description: 'Returns the full content of a specific version of a workspace file.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        filename: z.string().describe('Workspace filename'),
        version: z.string().describe('Version number'),
      }),
      response: {
        200: z.object({ version: z.any() }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const versionNum = parseInt(request.params.version, 10);
    if (isNaN(versionNum)) {
      return reply.code(400).send({ error: 'Invalid version number' });
    }

    try {
      const version = await workspaceService.getVersion(
        agentId, request.params.filename, versionNum
      );

      if (!version) {
        return reply.code(404).send({ error: 'Version not found' });
      }

      return {
        version: {
          version: version.version,
          userId: version.userId,
          createdAt: version.createdAt,
          contentLength: version.contentLength,
          action: version.action,
          content: version.content,
          filename: version.filename,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get version';
      return reply.code(400).send({ error: message });
    }
  });

  // POST /api/agents/:id/workspace/file/:filename/restore/:version - Restore version
  fastify.post<{
    Params: { id: string; filename: string; version: string };
  }>('/:id/workspace/file/:filename/restore/:version', {
    schema: {
      tags: ['Workspace'],
      summary: 'Restore a file version',
      description: 'Restores a workspace file to a specific version.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        filename: z.string().describe('Workspace filename'),
        version: z.string().describe('Version number to restore'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const versionNum = parseInt(request.params.version, 10);
    if (isNaN(versionNum)) {
      return reply.code(400).send({ error: 'Invalid version number' });
    }

    try {
      await workspaceService.restoreVersion(
        agentId, request.userId, request.params.filename, versionNum, request.organizationId
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore version';
      if (message.includes('not found')) {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  // GET /api/agents/:id/workspace - List all workspace files
  fastify.get<{ Params: { id: string }; Querystring: { directory?: string } }>(
    '/:id/workspace',
    {
      schema: {
        tags: ['Workspace'],
        summary: 'List all workspace files',
        description: 'Lists all files in the agent workspace directory. Optionally filter by subdirectory.',
        params: z.object({ id: objectIdSchema.describe('Agent ID') }),
        querystring: z.object({ directory: z.string().optional().describe('Subdirectory to list (default: root)') }),
        response: {
          200: z.object({ files: z.array(z.string()) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const files = await workspaceService.listFiles(
          agentId, request.userId, request.query.directory || '.', request.organizationId
        );
        return { files };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list files';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // Memory Files (memory/YYYY-MM-DD.md, MEMORY.md)
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/memory - List memory files
  fastify.get<{ Params: { id: string } }>('/:id/memory', {
    schema: {
      tags: ['Memory'],
      summary: 'List memory files',
      description: 'Lists all memory files for the agent, including MEMORY.md and daily memory logs (memory/YYYY-MM-DD.md).',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      response: {
        200: z.object({ files: z.array(z.string()) }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const files = await workspaceService.listMemoryFiles(
        agentId, request.userId, request.organizationId
      );
      return { files };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list memory files';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/memory/search - Search memory
  fastify.get<{ Params: { id: string }; Querystring: { q: string } }>(
    '/:id/memory/search',
    {
      schema: {
        tags: ['Memory'],
        summary: 'Search agent memory',
        description: 'Performs a semantic search across the agent memory files using the vector memory index.',
        params: z.object({ id: objectIdSchema.describe('Agent ID') }),
        querystring: z.object({ q: z.string().describe('Search query string') }),
        response: {
          200: z.object({ results: z.array(z.any()) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      const query = request.query.q;
      if (!query) {
        return reply.code(400).send({ error: 'q (query) parameter is required' });
      }

      try {
        const results = await workspaceService.searchMemory(
          agentId, request.userId, query, request.organizationId
        );
        return { results };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to search memory';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // GET /api/agents/:id/memory/file/* - Read a specific memory file
  fastify.get<{ Params: { id: string; '*': string } }>(
    '/:id/memory/file/*',
    {
      schema: {
        tags: ['Memory'],
        summary: 'Read a memory file',
        description: 'Reads a specific memory file by path (e.g. MEMORY.md or memory/2026-01-15.md).',
        params: z.object({
          id: objectIdSchema.describe('Agent ID'),
          '*': z.string().describe('Memory file path'),
        }),
        response: {
          200: z.object({ file: z.object({ name: z.string(), content: z.string() }) }),
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      const path = request.params['*'];
      if (!path) {
        return reply.code(400).send({ error: 'File path is required' });
      }

      // Prepend memory/ if not already present
      const memoryPath = path.startsWith('memory/') ? path : (path === 'MEMORY.md' || path === 'memory.md' ? path : `memory/${path}`);

      try {
        const file = await workspaceService.readMemoryFile(
          agentId, request.userId, memoryPath, request.organizationId
        );
        return { file };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to read memory file';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // PUT /api/agents/:id/memory/file/* - Write a memory file
  fastify.put<{ Params: { id: string; '*': string }; Body: { content: string } }>(
    '/:id/memory/file/*',
    {
      schema: {
        tags: ['Memory'],
        summary: 'Write a memory file',
        description: 'Creates or overwrites a memory file with the provided content.',
        params: z.object({
          id: objectIdSchema.describe('Agent ID'),
          '*': z.string().describe('Memory file path'),
        }),
        body: z.object({ content: z.string().describe('File content to write') }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
      preHandler: requirePermission('agents.workspace.edit'),
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      const path = request.params['*'];
      if (!path) {
        return reply.code(400).send({ error: 'File path is required' });
      }

      const { content } = request.body;
      if (content === undefined || content === null) {
        return reply.code(400).send({ error: 'content is required' });
      }

      const memoryPath = path.startsWith('memory/') ? path : (path === 'MEMORY.md' || path === 'memory.md' ? path : `memory/${path}`);

      try {
        await workspaceService.writeMemoryFile(
          agentId, request.userId, memoryPath, content, request.organizationId
        );
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to write memory file';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // DELETE /api/agents/:id/memory/file/* - Delete a memory file
  fastify.delete<{ Params: { id: string; '*': string } }>(
    '/:id/memory/file/*',
    {
      schema: {
        tags: ['Memory'],
        summary: 'Delete a memory file',
        description: 'Permanently deletes a memory file from the agent workspace.',
        params: z.object({
          id: objectIdSchema.describe('Agent ID'),
          '*': z.string().describe('Memory file path'),
        }),
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
      preHandler: requirePermission('agents.workspace.edit'),
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      const path = request.params['*'];
      if (!path) {
        return reply.code(400).send({ error: 'File path is required' });
      }

      const memoryPath = path.startsWith('memory/') ? path : (path === 'MEMORY.md' || path === 'memory.md' ? path : `memory/${path}`);

      try {
        await workspaceService.deleteMemoryFile(
          agentId, request.userId, memoryPath, request.organizationId
        );
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete memory file';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // DM Pairing Management
  // ═══════════════════════════════════════════════════════════════

  const PAIRING_CHANNELS = ['whatsapp', 'telegram', 'discord', 'slack', 'signal', 'imessage'];

  // GET /api/agents/:id/pairing-summary - Total pending pairing count across all channels
  fastify.get<{ Params: { id: string } }>(
    '/:id/pairing-summary',
    {
      schema: {
        tags: ['Agent Channels'],
        summary: 'Get pairing summary',
        description: 'Returns total count of pending DM pairing requests across all pairing-capable channels.',
        params: z.object({ id: objectIdSchema.describe('Agent ID') }),
        response: {
          200: z.object({ totalPending: z.number() }),
          400: errorResponseSchema,
          404: notFoundErrorSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const { gatewayManager } = await import('../../services/gateway-ws.service.js');
        const { ObjectId } = await import('mongodb');
        const { getDatabase } = await import('../../config/database.js');
        const filter: any = { _id: new ObjectId(agentId) };
        if (request.organizationId) {
          filter.organizationId = request.organizationId;
        } else {
          filter.userId = request.userId;
        }

        const db = getDatabase();
        const agent = await db.collection('agents').findOne(filter);
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
        if (!agent.gatewayUrl || !agent.gatewayToken) {
          return { totalPending: 0 };
        }

        if (!gatewayManager.isConnected(agentId)) {
          await gatewayManager.connectAgent({
            agentId,
            url: agent.gatewayUrl,
            token: agent.gatewayToken,
          });
        }

        const client = gatewayManager.getClient(agentId);
        if (!client) return { totalPending: 0 };

        let totalPending = 0;
        const agentChannels = (agent.channels as string[] | undefined)?.filter(
          (ch: string) => PAIRING_CHANNELS.includes(ch)
        ) ?? [];
        for (const channel of agentChannels) {
          try {
            const requests = await client.pairingList(channel);
            totalPending += Array.isArray(requests) ? requests.length : 0;
          } catch {
            // Channel may not be configured in gateway
          }
        }
        return { totalPending };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get pairing summary';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // GET /api/agents/:id/pairing/:channel - List pending pairing requests
  fastify.get<{ Params: { id: string; channel: string } }>(
    '/:id/pairing/:channel',
    {
      schema: {
        tags: ['Agent Channels'],
        summary: 'List pending pairing requests',
        description: 'Returns all pending DM pairing requests for the specified channel on this agent.',
        params: z.object({
          id: objectIdSchema.describe('Agent ID'),
          channel: z.string().describe('Channel type (e.g. whatsapp, telegram, discord)'),
        }),
        response: {
          200: z.object({ requests: z.array(z.any()) }),
          400: errorResponseSchema,
          404: notFoundErrorSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      if (!validateObjectId(agentId)) {
        return reply.code(400).send({ error: 'Invalid agent ID format' });
      }

      try {
        const { gatewayManager } = await import('../../services/gateway-ws.service.js');
        const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
        if (request.organizationId) {
          filter.organizationId = request.organizationId;
        } else {
          filter.userId = request.userId;
        }

        const db = (await import('../../config/database.js')).getDatabase();
        const agent = await db.collection('agents').findOne(filter);
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
        if (!agent.gatewayUrl || !agent.gatewayToken) {
          return reply.code(400).send({ error: 'Agent not deployed' });
        }

        if (!gatewayManager.isConnected(agentId)) {
          await gatewayManager.connectAgent({
            agentId,
            url: agent.gatewayUrl,
            token: agent.gatewayToken,
          });
        }

        const client = gatewayManager.getClient(agentId);
        if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

        const result = await client.pairingList(request.params.channel);
        return { requests: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list pairing requests';
        return reply.code(502).send({ error: message });
      }
    }
  );

  // POST /api/agents/:id/pairing/:channel/approve - Approve a pairing request
  fastify.post<{
    Params: { id: string; channel: string };
    Body: { code: string };
  }>('/:id/pairing/:channel/approve', {
    schema: {
      tags: ['Agent Channels'],
      summary: 'Approve a pairing request',
      description: 'Approves a pending DM pairing request using the provided pairing code.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        channel: z.string().describe('Channel type (e.g. whatsapp, telegram)'),
      }),
      body: z.object({ code: z.string().describe('Pairing code from the requesting user') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { code } = request.body;
    if (!code) {
      return reply.code(400).send({ error: 'code is required' });
    }

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      await client.pairingApprove(request.params.channel, code);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve pairing';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/pairing/:channel/reject - Reject a pairing request
  fastify.post<{
    Params: { id: string; channel: string };
    Body: { code: string };
  }>('/:id/pairing/:channel/reject', {
    schema: {
      tags: ['Agent Channels'],
      summary: 'Reject a pairing request',
      description: 'Rejects a pending DM pairing request using the provided pairing code.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        channel: z.string().describe('Channel type (e.g. whatsapp, telegram)'),
      }),
      body: z.object({ code: z.string().describe('Pairing code from the requesting user') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { code } = request.body;
    if (!code) {
      return reply.code(400).send({ error: 'code is required' });
    }

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      await client.pairingReject(request.params.channel, code);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject pairing';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Channel Login (QR Code for WhatsApp, etc.)
  // ═══════════════════════════════════════════════════════════════

  // POST /api/agents/:id/channels/login/start - Start channel login flow (generates QR)
  fastify.post<{
    Params: { id: string };
    Body: { channel?: string; relink?: boolean };
  }>('/:id/channels/login/start', {
    schema: {
      tags: ['Agent Channels'],
      summary: 'Start channel login flow',
      description: 'Initiates a channel login flow (e.g. WhatsApp QR code generation) for the agent. Pass relink: true for a fresh QR when already linked.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      body: z.object({
        channel: z.string().optional().describe('Channel type (default: whatsapp)'),
        relink: z.boolean().optional().describe('Force relink (fresh QR) when already connected'),
      }),
      response: {
        200: z.object({}).passthrough(),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const channel = request.body.channel || 'whatsapp';
    const relink = Boolean(request.body.relink);

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      // Relink: Clear stale WhatsApp credentials first. Otherwise OpenClaw returns "already linked"
      // but with invalid session (401), and force=true still loads old creds → no QR, infinite loop.
      if (relink && channel === 'whatsapp') {
        try {
          await client.channelLogout(channel);
        } catch (e) {
          // Non-fatal: logout may fail if channel wasn't connected
        }
      }

      const result = await client.channelLoginStart(channel, 'default', relink);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start login';
      return reply.code(502).send({ error: message });
    }
  });

  // GET /api/agents/:id/channels/login/status - Get login status (QR code, connected, etc.)
  fastify.get<{
    Params: { id: string };
    Querystring: { channel?: string };
  }>('/:id/channels/login/status', {
    schema: {
      tags: ['Agent Channels'],
      summary: 'Get channel login status',
      description: 'Returns the current login status for a channel, including QR code data if available.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      querystring: z.object({ channel: z.string().optional().describe('Channel type (default: whatsapp)') }),
      response: {
        200: z.object({}).passthrough(),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const channel = request.query.channel || 'whatsapp';

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      const result = await client.channelLoginStatus(channel);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get login status';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/channels/login/stop - Stop/cancel login flow
  fastify.post<{
    Params: { id: string };
    Body: { channel?: string };
  }>('/:id/channels/login/stop', {
    schema: {
      tags: ['Agent Channels'],
      summary: 'Stop channel login flow',
      description: 'Cancels an in-progress channel login flow and cleans up any pending QR sessions.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      body: z.object({ channel: z.string().optional().describe('Channel type (default: whatsapp)') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const channel = request.body.channel || 'whatsapp';

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      await client.channelLoginStop(channel);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop login';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Exec Approvals
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/exec-approvals - List pending exec approvals
  fastify.get<{ Params: { id: string } }>('/:id/exec-approvals', {
    schema: {
      tags: ['Gateway'],
      summary: 'List pending exec approvals',
      description: 'Returns all pending command execution approval requests for the agent.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      response: {
        200: z.object({ approvals: z.array(z.any()) }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      const result = await client.execApprovalsList();
      return { approvals: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list exec approvals';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/exec-approvals/:requestId/resolve - Resolve an exec approval
  fastify.post<{
    Params: { id: string; requestId: string };
    Body: { approved: boolean };
  }>('/:id/exec-approvals/:requestId/resolve', {
    schema: {
      tags: ['Gateway'],
      summary: 'Resolve an exec approval',
      description: 'Approves or rejects a pending command execution request by its request ID.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        requestId: z.string().describe('Exec approval request ID'),
      }),
      body: z.object({ approved: z.boolean().describe('Whether to approve (true) or reject (false) the execution') }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const { approved } = request.body;
    if (approved === undefined) {
      return reply.code(400).send({ error: 'approved (boolean) is required' });
    }

    try {
      const { gatewayManager } = await import('../../services/gateway-ws.service.js');
      const filter: any = { _id: new (await import('mongodb')).ObjectId(agentId) };
      if (request.organizationId) {
        filter.organizationId = request.organizationId;
      } else {
        filter.userId = request.userId;
      }

      const db = (await import('../../config/database.js')).getDatabase();
      const agent = await db.collection('agents').findOne(filter);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      if (!agent.gatewayUrl || !agent.gatewayToken) {
        return reply.code(400).send({ error: 'Agent not deployed' });
      }

      if (!gatewayManager.isConnected(agentId)) {
        await gatewayManager.connectAgent({
          agentId,
          url: agent.gatewayUrl,
          token: agent.gatewayToken,
        });
      }

      const client = gatewayManager.getClient(agentId);
      if (!client) return reply.code(502).send({ error: 'Failed to connect to gateway' });

      await client.execApprovalResolve(request.params.requestId, approved);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve exec approval';
      return reply.code(502).send({ error: message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Knowledge Files (knowledge/ directory)
  // ═══════════════════════════════════════════════════════════════

  // GET /api/agents/:id/knowledge - List knowledge files
  fastify.get<{ Params: { id: string } }>('/:id/knowledge', {
    schema: {
      tags: ['Knowledge'],
      summary: 'List knowledge files',
      description: 'Lists all knowledge files for the agent, including uploaded documents, crawled URLs, manual notes, and system memory.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      response: {
        200: z.object({
          files: z.array(z.object({
            filename: z.string(),
            size: z.number(),
            type: z.enum(['upload', 'url', 'manual', 'system']),
          })),
        }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const files = await workspaceService.listKnowledgeFiles(
        agentId, request.userId, request.organizationId
      );
      return { files };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list knowledge files';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/knowledge/text - Add manual text knowledge
  fastify.post<{
    Params: { id: string };
    Body: { title: string; content: string };
  }>('/:id/knowledge/text', {
    schema: {
      tags: ['Knowledge'],
      summary: 'Add text knowledge',
      description: 'Add a manual text document to the agent\'s knowledge base.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      body: z.object({
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(500000),
      }),
      response: {
        200: z.object({ filename: z.string(), size: z.number() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const { title, content } = request.body;
      const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').substring(0, 100);
      const filename = `${safeTitle}.md`;
      const fullContent = `# ${title}\n\n${content}`;

      await workspaceService.writeKnowledgeFile(
        agentId, request.userId, filename, fullContent, request.organizationId
      );

      return { filename: `knowledge/${filename}`, size: fullContent.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add knowledge';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/knowledge/url - Crawl a URL and save as knowledge
  fastify.post<{
    Params: { id: string };
    Body: { url: string };
  }>('/:id/knowledge/url', {
    schema: {
      tags: ['Knowledge'],
      summary: 'Crawl URL as knowledge',
      description: 'Fetches a URL, extracts its content, and saves it as a knowledge file.',
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      body: z.object({
        url: z.string().url(),
      }),
      response: {
        200: z.object({ filename: z.string(), size: z.number() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      const result = await workspaceService.crawlUrl(
        agentId, request.userId, request.body.url, request.organizationId
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to crawl URL';
      return reply.code(502).send({ error: message });
    }
  });

  // POST /api/agents/:id/knowledge/upload - Upload a document file
  fastify.post<{
    Params: { id: string };
  }>('/:id/knowledge/upload', {
    schema: {
      tags: ['Knowledge'],
      summary: 'Upload a document to knowledge base',
      description: `Upload a file (PDF, DOCX, TXT, MD, CSV) to the agent's knowledge base. The file is parsed to text and saved as markdown. Max 20 MB.`,
      params: z.object({ id: objectIdSchema.describe('Agent ID') }),
      response: {
        200: z.object({ filename: z.string(), size: z.number(), pageCount: z.number().optional() }),
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({ error: 'No file uploaded or file too large (max 20 MB)' });
    }

    if (!file) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const originalName = file.filename || 'document';
    if (!isSupportedFormat(originalName)) {
      return reply.code(400).send({
        error: `Unsupported file format. Supported: ${getSupportedFormats().join(', ')}`,
      });
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'Empty file' });
      }

      const parsed = await parseDocument(buffer, originalName, file.mimetype);

      if (!parsed.content || parsed.content.trim().length === 0) {
        return reply.code(400).send({ error: 'Could not extract text from file. The file may be empty or image-only.' });
      }

      // Generate safe filename
      const baseName = originalName
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 80);
      const mdFilename = `${baseName}.md`;

      const header = `<!-- Uploaded: ${originalName} -->\n<!-- Parsed: ${new Date().toISOString()} -->\n\n`;
      const fullContent = header + parsed.content;

      await workspaceService.writeKnowledgeFile(
        agentId, request.userId, mdFilename, fullContent, request.organizationId
      );

      return {
        filename: `knowledge/${mdFilename}`,
        size: fullContent.length,
        ...(parsed.pageCount !== undefined ? { pageCount: parsed.pageCount } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process file';
      return reply.code(502).send({ error: message });
    }
  });

  // DELETE /api/agents/:id/knowledge/:filename - Delete a knowledge file
  fastify.delete<{
    Params: { id: string; filename: string };
  }>('/:id/knowledge/:filename', {
    schema: {
      tags: ['Knowledge'],
      summary: 'Delete knowledge file',
      description: 'Deletes a specific knowledge file from the agent\'s knowledge base.',
      params: z.object({
        id: objectIdSchema.describe('Agent ID'),
        filename: z.string().describe('Knowledge filename (without knowledge/ prefix)'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        502: errorResponseSchema,
      },
    },
    preHandler: requirePermission('agents.workspace.edit'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    try {
      await workspaceService.deleteKnowledgeFile(
        agentId, request.userId, `knowledge/${request.params.filename}`, request.organizationId
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete knowledge file';
      return reply.code(502).send({ error: message });
    }
  });
}
