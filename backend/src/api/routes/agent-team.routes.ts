import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { validateObjectId } from '../../validation/schemas.js';
import {
  successResponseSchema,
  errorResponseSchema,
  notFoundErrorSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

export async function agentTeamRoutes(fastify: FastifyInstance) {
  // Trial guard: block mutations when trial expired
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' && request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired. Please upgrade to continue.' });
    }
  });

  const db = getDatabase();
  const agentsCollection = db.collection('agents');
  const usersCollection = db.collection('users');

  // Helper: build agent ownership filter (personal or org)
  function agentOwnerFilter(request: any, agentId: string) {
    const filter: any = { _id: new ObjectId(agentId) as any };
    if (request.organizationId) {
      filter.organizationId = request.organizationId;
    } else {
      filter.userId = request.userId;
    }
    return filter;
  }

  // GET /api/agents/:id/team - Get agent team members
  fastify.get<{ Params: { id: string } }>('/:id/team', {
    schema: {
      tags: ['Agent Team'],
      summary: 'List team members',
      description: 'Get all team members assigned to a specific agent, enriched with user profile details.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: z.object({
          team: z.array(z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
            permissions: z.array(z.string()),
            addedAt: z.string(),
          })),
        }),
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const agent = await agentsCollection.findOne(agentOwnerFilter(request, agentId));

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Get team members from agent.team array
    const teamMembers = agent.team || [];

    // Enrich with user details
    const enrichedMembers = await Promise.all(
      teamMembers.map(async (member: any) => {
        const user = await usersCollection.findOne({ clerkId: member.userId });
        return {
          id: member.userId,
          name: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          email: user?.email || '',
          role: member.role,
          permissions: member.permissions || [],
          addedAt: member.addedAt instanceof Date ? member.addedAt.toISOString() : (member.addedAt || new Date().toISOString()),
        };
      })
    );

    return { team: enrichedMembers };
  });

  // POST /api/agents/:id/team - Add team member
  fastify.post<{ Params: { id: string }; Body: any }>('/:id/team', {
    schema: {
      tags: ['Agent Team'],
      summary: 'Add a team member',
      description: 'Add a new team member to an agent with a specified role and optional permissions.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: z.object({
        userId: z.string().describe('Clerk user ID of the member to add'),
        role: z.string().describe('Team role (e.g. owner, admin, member)'),
        permissions: z.array(z.string()).optional().describe('Granular permissions'),
      }),
      response: {
        201: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.team.manage'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    const body = request.body as any;
    const { userId: memberUserId, role, permissions } = body;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    if (!memberUserId || !role) {
      return reply.code(400).send({ error: 'userId and role are required' });
    }

    const member = {
      userId: memberUserId,
      role,
      permissions: permissions || [],
      addedAt: new Date(),
    };

    const result = await agentsCollection.updateOne(
      agentOwnerFilter(request, agentId),
      { $push: { team: member } as any }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return reply.code(201).send({ success: true });
  });

  // DELETE /api/agents/:id/team/:memberId - Remove team member
  fastify.delete<{ Params: { id: string; memberId: string } }>('/:id/team/:memberId', {
    schema: {
      tags: ['Agent Team'],
      summary: 'Remove a team member',
      description: 'Remove a team member from an agent by their user ID.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        memberId: z.string().describe('User ID of the member to remove'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.team.manage'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    const memberId = request.params.memberId;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const result = await agentsCollection.updateOne(
      agentOwnerFilter(request, agentId),
      { $pull: { team: { userId: memberId } } as any }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return { success: true };
  });

  // PATCH /api/agents/:id/team/:memberId - Update team member
  fastify.patch<{ Params: { id: string; memberId: string }; Body: any }>('/:id/team/:memberId', {
    schema: {
      tags: ['Agent Team'],
      summary: 'Update a team member',
      description: 'Update a team member\'s role or permissions on an agent.',
      params: z.object({
        id: z.string().describe('Agent ID'),
        memberId: z.string().describe('User ID of the member to update'),
      }),
      body: z.object({
        role: z.string().optional().describe('New team role'),
        permissions: z.array(z.string()).optional().describe('Updated permissions'),
      }),
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.team.manage'),
  }, async (request, reply) => {
    const agentId = request.params.id;
    const memberId = request.params.memberId;
    const body = request.body as any;
    const { role, permissions } = body;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const updates: any = {};
    if (role) updates['team.$.role'] = role;
    if (permissions) updates['team.$.permissions'] = permissions;

    const baseFilter = agentOwnerFilter(request, agentId);
    const result = await agentsCollection.updateOne(
      { ...baseFilter, 'team.userId': memberId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Agent or team member not found' });
    }

    return { success: true };
  });
}
