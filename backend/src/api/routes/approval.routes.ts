import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { approvalService } from '../../services/approval.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { validateObjectId } from '../../validation/schemas.js';

const resolveBodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().max(2000).optional(),
});

const createBodySchema = z.object({
  agentId: z.string().min(1),
  sessionKey: z.string().optional(),
  channel: z.string().optional(),
  actionType: z.enum([
    'purchase', 'booking', 'send_message', 'contract',
    'payment', 'data_export', 'account_change', 'escalation', 'custom',
  ]),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(5000),
  payload: z.record(z.any()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  ttlMinutes: z.number().min(1).max(10080).optional(),
});

export async function approvalRoutes(fastify: FastifyInstance) {
  const scopeIdFromRequest = (request: { organizationId?: string; userId?: string }) =>
    request.organizationId || `user:${request.userId}`;

  // GET / — List approvals
  fastify.get('/', {
    preHandler: requirePermission('approvals.view'),
    schema: {
      tags: ['Approvals'],
      summary: 'List approval requests',
      querystring: z.object({
        status: z.string().optional(),
        agentId: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(50).optional(),
        offset: z.coerce.number().min(0).default(0).optional(),
      }),
    },
  }, async (request) => {
    const organizationId = scopeIdFromRequest(request);
    const { status, agentId, limit, offset } = request.query as any;
    return approvalService.listApprovals(organizationId, { status, agentId, limit, offset });
  });

  // GET /counts — Approval counts for badge
  fastify.get('/counts', {
    preHandler: requirePermission('approvals.view'),
    schema: { tags: ['Approvals'], summary: 'Get approval counts' },
  }, async (request) => {
    const organizationId = scopeIdFromRequest(request);
    return approvalService.getCounts(organizationId);
  });

  // GET /:id — Single approval
  fastify.get('/:id', {
    preHandler: requirePermission('approvals.view'),
    schema: { tags: ['Approvals'], summary: 'Get single approval' },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateObjectId(id)) return reply.code(400).send({ error: 'Invalid approval ID format' });
    const organizationId = scopeIdFromRequest(request);
    const approval = await approvalService.getApproval(id, organizationId);
    if (!approval) return reply.code(404).send({ error: 'Approval not found' });
    return { approval };
  });

  // POST /:id/resolve — Approve or reject
  fastify.post('/:id/resolve', {
    preHandler: requirePermission('approvals.manage'),
    schema: {
      tags: ['Approvals'],
      summary: 'Resolve an approval request',
      body: resolveBodySchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateObjectId(id)) return reply.code(400).send({ error: 'Invalid approval ID format' });
    const organizationId = scopeIdFromRequest(request);
    const userId = request.userId!;
    const body = resolveBodySchema.parse(request.body);

    const approval = await approvalService.resolveApproval(id, organizationId, userId, body);
    if (!approval) return reply.code(404).send({ error: 'Approval not found or already resolved' });
    return { approval };
  });

  // POST / — Create approval (called by agent webhook)
  fastify.post('/', {
    schema: {
      tags: ['Approvals'],
      summary: 'Create an approval request (agent webhook)',
      body: createBodySchema,
    },
  }, async (request, reply) => {
    const organizationId = scopeIdFromRequest(request);
    const body = createBodySchema.parse(request.body);
    const approval = await approvalService.createApproval(organizationId, body);
    return reply.code(201).send({ approval });
  });
}
