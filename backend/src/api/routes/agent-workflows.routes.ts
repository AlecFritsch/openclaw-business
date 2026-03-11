import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';
import { z } from 'zod';
import { successResponseSchema, errorResponseSchema, notFoundErrorSchema } from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { createRun, approveRun, cancelRun, getRunHistory, getRun, getWorkflowStats, WORKFLOW_TEMPLATES, stepsToYaml } from '../../services/workflow-engine.service.js';
import { gatewayManager } from '../../services/gateway-ws.service.js';
import { workspaceService } from '../../services/workspace.service.js';
import crypto from 'crypto';

function emitWorkflowEvent(agentId: string, action: string, workflow?: any) {
  gatewayManager.emit('gateway_event', {
    agentId,
    event: 'workflow:update',
    payload: { action, workflow: workflow ? { _id: workflow._id?.toString(), name: workflow.name, status: workflow.status, steps: workflow.steps } : undefined },
  });
}

export async function agentWorkflowsRoutes(fastify: FastifyInstance) {
  // Rate limit mutations (POST/PUT/PATCH/DELETE): 60/min
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method !== 'GET' && !routeOptions.config?.rateLimit) {
      routeOptions.config = { ...routeOptions.config, rateLimit: { max: 60, timeWindow: '1 minute' } };
    }
  });
  const db = getDatabase();
  const agentsCol = db.collection('agents');
  const workflowsCol = db.collection('workflows');

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({ error: 'Trial expired', message: 'Your 7-day trial has expired. Upgrade to Professional to continue.' });
    }
  });

  async function verifyAgent(request: any, agentId: string) {
    if (!validateObjectId(agentId)) return null;
    const filter: any = { _id: new ObjectId(agentId) };
    if (request.organizationId) filter.organizationId = request.organizationId;
    else filter.userId = request.userId;
    return agentsCol.findOne(filter);
  }

  // ── LIST ──────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id/workflows', {
    schema: { tags: ['Workflows'], summary: 'List workflows', params: z.object({ id: z.string() }), response: { 200: z.object({ workflows: z.array(z.any()), stats: z.any() }) } },
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const wfs = await workflowsCol.find({ agentId: request.params.id }).sort({ createdAt: -1 }).toArray();
    const stats = await getWorkflowStats(request.params.id, request.organizationId || '');
    return { workflows: wfs, stats };
  });

  // ── CREATE ────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/:id/workflows', {
    schema: { tags: ['Workflows'], summary: 'Create workflow', params: z.object({ id: z.string() }) },
    preHandler: requirePermission('agents.workflows.manage'),
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const body = request.body as any;
    const workflow = {
      agentId: request.params.id,
      organizationId: request.organizationId,
      userId: request.userId,
      name: body.name || 'Untitled Workflow',
      description: body.description || '',
      steps: body.steps || [],
      variables: body.variables || [],
      trigger: body.trigger || { type: 'manual', config: {} },
      content: body.content || stepsToYaml(body.name || 'workflow', body.steps || [], body.variables),
      status: 'active',
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      totalRuns: 0,
      successRuns: 0,
      lastRun: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await workflowsCol.insertOne(workflow);
    emitWorkflowEvent(request.params.id, 'created', { ...workflow, _id: result.insertedId });
    return reply.code(201).send({ workflow: { ...workflow, _id: result.insertedId.toString() } });
  });

  // ── UPDATE ────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId', {
    schema: { tags: ['Workflows'], summary: 'Update workflow', params: z.object({ id: z.string(), workflowId: z.string() }) },
    preHandler: requirePermission('agents.workflows.manage'),
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (!validateObjectId(request.params.workflowId)) return reply.code(400).send({ error: 'Invalid workflow ID' });

    const body = request.body as any;
    const updates: any = { updatedAt: new Date() };
    for (const key of ['name', 'description', 'steps', 'variables', 'trigger', 'content', 'status']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    // Regenerate YAML if steps changed
    if (body.steps && !body.content) {
      updates.content = stepsToYaml(body.name || 'workflow', body.steps, body.variables);
    }

    const result = await workflowsCol.updateOne({ _id: new ObjectId(request.params.workflowId), agentId: request.params.id }, { $set: updates });
    if (result.matchedCount === 0) return reply.code(404).send({ error: 'Workflow not found' });
    emitWorkflowEvent(request.params.id, 'updated', { _id: request.params.workflowId, ...updates });
    return { success: true };
  });

  // ── DELETE ────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId', {
    schema: { tags: ['Workflows'], summary: 'Delete workflow', params: z.object({ id: z.string(), workflowId: z.string() }) },
    preHandler: requirePermission('agents.workflows.manage'),
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (!validateObjectId(request.params.workflowId)) return reply.code(400).send({ error: 'Invalid workflow ID' });

    const result = await workflowsCol.deleteOne({ _id: new ObjectId(request.params.workflowId), agentId: request.params.id });
    if (result.deletedCount === 0) return reply.code(404).send({ error: 'Workflow not found' });
    await getDatabase().collection('workflow_runs').deleteMany({ workflowId: request.params.workflowId });
    emitWorkflowEvent(request.params.id, 'deleted', { _id: request.params.workflowId });
    return { success: true };
  });

  // ── SYNC from workspace .lobster files ────────────────────────
  fastify.post<{ Params: { id: string } }>('/:id/workflows/sync', {
    schema: { tags: ['Workflows'], summary: 'Sync .lobster files from workspace into DB', params: z.object({ id: z.string() }) },
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    try {
      const files = await workspaceService.listFiles(request.params.id, request.userId!, '.', request.organizationId);
      const flowFiles = await workspaceService.listFiles(request.params.id, request.userId!, 'flows', request.organizationId).catch(() => [] as string[]);
      const allFiles = [...files, ...flowFiles.map(f => `flows/${f}`)];
      const lobsterFiles = allFiles.filter(f => f.endsWith('.lobster'));
      if (!lobsterFiles.length) return { synced: 0, workflows: [] };

      const existing = await workflowsCol.find({ agentId: request.params.id, sourceFile: { $in: lobsterFiles } }).toArray();
      const existingMap = new Set(existing.map(w => w.sourceFile));

      const synced: any[] = [];
      for (const file of lobsterFiles) {
        if (existingMap.has(file)) continue;
        try {
          const { content } = await workspaceService.readFile(request.params.id, request.userId!, file, request.organizationId);
          if (!content?.trim()) continue;

          // Parse name from YAML (first "name:" line)
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const name = nameMatch?.[1]?.trim()?.replace(/^["']|["']$/g, '') || file.replace('.lobster', '');

          // Parse steps from YAML
          const steps: any[] = [];
          const stepMatches = content.matchAll(/^\s*-\s*id:\s*(.+)$/gm);
          for (const m of stepMatches) steps.push({ id: m[1].trim() });

          const workflow = {
            agentId: request.params.id,
            organizationId: request.organizationId,
            userId: request.userId,
            name,
            description: `Synced from ${file}`,
            steps,
            variables: [],
            trigger: { type: 'manual', config: {} },
            content,
            sourceFile: file,
            status: 'pending',
            webhookSecret: crypto.randomBytes(16).toString('hex'),
            totalRuns: 0, successRuns: 0, lastRun: null,
            createdAt: new Date(), updatedAt: new Date(),
          };
          const result = await workflowsCol.insertOne(workflow);
          const created = { ...workflow, _id: result.insertedId };
          emitWorkflowEvent(request.params.id, 'created', created);
          synced.push(created);
        } catch { /* skip unreadable files */ }
      }
      return { synced: synced.length, workflows: synced };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message || 'Sync failed' });
    }
  });

  // ── RUN ───────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId/run', {
    schema: { tags: ['Workflows'], summary: 'Trigger workflow run', params: z.object({ id: z.string(), workflowId: z.string() }) },
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (!validateObjectId(request.params.workflowId)) return reply.code(400).send({ error: 'Invalid workflow ID' });

    const body = request.body as any;
    try {
      const run = await createRun(request.params.workflowId, request.params.id, request.organizationId || '', {
        variables: body?.variables,
        triggeredBy: 'manual',
        userId: request.userId,
      });
      return { success: true, run };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── RUN HISTORY ───────────────────────────────────────────────
  fastify.get<{ Params: { id: string; workflowId: string }; Querystring: { limit?: string; offset?: string } }>('/:id/workflows/:workflowId/runs', {
    schema: { tags: ['Workflows'], summary: 'Get run history', params: z.object({ id: z.string(), workflowId: z.string() }) },
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const runs = await getRunHistory(request.params.workflowId, {
      limit: parseInt(request.query.limit || '20'),
      offset: parseInt(request.query.offset || '0'),
    });
    return { runs };
  });

  // ── RUN DETAIL ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string; workflowId: string; runId: string } }>('/:id/workflows/:workflowId/runs/:runId', {
    schema: { tags: ['Workflows'], summary: 'Get run detail', params: z.object({ id: z.string(), workflowId: z.string(), runId: z.string() }) },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.runId)) return reply.code(400).send({ error: 'Invalid run ID' });
    const run = await getRun(request.params.runId);
    if (!run || run.workflowId !== request.params.workflowId) return reply.code(404).send({ error: 'Run not found' });
    return { run };
  });

  // ── APPROVE / REJECT ──────────────────────────────────────────
  fastify.post<{ Params: { id: string; workflowId: string; runId: string } }>('/:id/workflows/:workflowId/runs/:runId/approve', {
    schema: { tags: ['Workflows'], summary: 'Approve or reject a pending step' },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.runId)) return reply.code(400).send({ error: 'Invalid run ID' });
    const body = request.body as any;
    try {
      await approveRun(request.params.runId, body?.approved !== false, request.userId);
      return { success: true };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── CANCEL RUN ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string; workflowId: string; runId: string } }>('/:id/workflows/:workflowId/runs/:runId/cancel', {
    schema: { tags: ['Workflows'], summary: 'Cancel a running workflow' },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.runId)) return reply.code(400).send({ error: 'Invalid run ID' });
    await cancelRun(request.params.runId);
    return { success: true };
  });

  // ── WEBHOOK TRIGGER ───────────────────────────────────────────
  fastify.post<{ Params: { id: string; workflowId: string } }>('/:id/workflows/:workflowId/webhook', {
    schema: { tags: ['Workflows'], summary: 'Trigger workflow via webhook' },
  }, async (request, reply) => {
    if (!validateObjectId(request.params.workflowId)) return reply.code(400).send({ error: 'Invalid workflow ID' });

    const workflow = await workflowsCol.findOne({ _id: new ObjectId(request.params.workflowId), agentId: request.params.id, status: 'active' });
    if (!workflow) return reply.code(404).send({ error: 'Workflow not found or inactive' });

    // Verify webhook secret
    const body = request.body as any;
    if (workflow.webhookSecret && body?.secret !== workflow.webhookSecret) {
      return reply.code(401).send({ error: 'Invalid webhook secret' });
    }

    try {
      const run = await createRun(request.params.workflowId, request.params.id, workflow.organizationId, {
        variables: body?.variables || body?.data,
        triggeredBy: 'webhook',
      });
      return { success: true, runId: run._id };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── TEMPLATES ─────────────────────────────────────────────────
  fastify.get('/:id/workflows/templates', {
    schema: { tags: ['Workflows'], summary: 'Get workflow templates' },
  }, async () => {
    return { templates: WORKFLOW_TEMPLATES };
  });

  // ── DEPLOY TEMPLATE ───────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/:id/workflows/from-template', {
    schema: { tags: ['Workflows'], summary: 'Create workflow from template' },
    preHandler: requirePermission('agents.workflows.manage'),
  }, async (request, reply) => {
    const agent = await verifyAgent(request, request.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const body = request.body as any;
    const template = WORKFLOW_TEMPLATES.find(t => t.id === body?.templateId);
    if (!template) return reply.code(400).send({ error: 'Template not found' });

    const workflow = {
      agentId: request.params.id,
      organizationId: request.organizationId,
      userId: request.userId,
      name: body.name || template.name,
      description: template.description,
      steps: template.steps,
      variables: template.variables,
      trigger: { type: 'manual', config: {} },
      content: stepsToYaml(template.name, template.steps as any, template.variables as any),
      status: 'active',
      webhookSecret: crypto.randomBytes(16).toString('hex'),
      totalRuns: 0,
      successRuns: 0,
      lastRun: null,
      templateId: template.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await workflowsCol.insertOne(workflow);
    emitWorkflowEvent(request.params.id, 'created', { ...workflow, _id: result.insertedId });
    return reply.code(201).send({ workflow: { ...workflow, _id: result.insertedId.toString() } });
  });
}
