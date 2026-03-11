// ── Actionable Compliance: Audit Trail API ──────────────────────
// Revisionssichere Abfrage, Export und Compliance-Reporting.
// Alle Endpunkte sind read-only (Audit Trail ist immutable).

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditService, buildUserActor, buildRequestContext } from '../../services/audit.service.js';
import { serializeDoc } from '../../utils/sanitize.js';
import { errorResponseSchema } from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

/** Safe parseInt with NaN fallback */
function safeInt(value: string | undefined, fallback: number, min = 0, max = Infinity): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Validate ISO date string — returns true if parseable */
function isValidDate(str: string | undefined): boolean {
  if (!str) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

export async function auditRoutes(fastify: FastifyInstance) {

  // ── GET /api/audit - Audit Trail abfragen ─────────────────────
  fastify.get('/', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Query audit trail',
      description: 'Returns a paginated, filterable audit trail for the organization.',
      querystring: z.object({
        agentId: z.string().optional(),
        category: z.string().optional(),
        action: z.string().optional(),
        riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        outcome: z.enum(['success', 'failure', 'denied', 'partial', 'pending']).optional(),
        actorType: z.enum(['user', 'agent', 'system', 'cron', 'webhook', 'api_key']).optional(),
        search: z.string().max(200).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
    },
    preHandler: requirePermission('audit.view'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required for audit trail' });
      }

      const raw = request.query as any;

      // Validate date params if provided
      if (raw.from && !isValidDate(raw.from)) {
        return reply.code(400).send({ error: 'Invalid "from" date format. Use ISO 8601.' });
      }
      if (raw.to && !isValidDate(raw.to)) {
        return reply.code(400).send({ error: 'Invalid "to" date format. Use ISO 8601.' });
      }

      const params = {
        ...raw,
        limit: safeInt(raw.limit, 50, 1, 500),
        offset: safeInt(raw.offset, 0, 0),
      };

      const result = await auditService.query(organizationId, params);
      return {
        entries: result.entries.map(e => serializeDoc(e)),
        total: result.total,
        integrityStatus: result.integrityStatus,
      };
    } catch (err) {
      request.log.error(err, '[audit] Failed to query audit trail');
      return reply.code(500).send({ error: 'Failed to query audit trail' });
    }
  });

  // ── GET /api/audit/stats - Compliance Statistiken ──────────────
  fastify.get('/stats', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Get audit statistics',
      description: 'Returns aggregate statistics about the audit trail.',
    },
    preHandler: requirePermission('audit.view'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required' });
      }

      return auditService.getStats(organizationId);
    } catch (err) {
      request.log.error(err, '[audit] Failed to get stats');
      return reply.code(500).send({ error: 'Failed to get audit stats' });
    }
  });

  // ── GET /api/audit/verify - Hash-Chain verifizieren ────────────
  fastify.get('/verify', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Verify audit trail integrity',
      description: 'Verifies the SHA-256 hash chain of the entire audit trail.',
      querystring: z.object({
        limit: z.string().optional(),
      }),
    },
    preHandler: requirePermission('audit.verify'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required' });
      }

      const raw = request.query as any;
      const limit = safeInt(raw.limit, 10000, 100, 100000);

      const result = await auditService.verifyIntegrity(organizationId, { limit });

      // Best-effort: audit recording darf nicht die Verify-Response killen
      auditService.record({
        organizationId,
        actor: buildUserActor(request),
        category: 'compliance.policy',
        action: 'compliance.integrity_check',
        title: 'Audit Trail Integrity Check',
        description: `Hash chain verification completed: ${result.status} (${result.checkedEntries} entries checked)`,
        riskLevel: 'low',
        outcome: result.status === 'valid' ? 'success' : 'failure',
        requestContext: buildRequestContext(request),
      }).catch(err => fastify.log.warn({ err }, '[audit] Failed to record verify event'));

      return serializeDoc(result);
    } catch (err) {
      request.log.error(err, '[audit] Failed to verify integrity');
      return reply.code(500).send({ error: 'Failed to verify audit trail integrity' });
    }
  });

  // ── GET /api/audit/export - Audit Trail exportieren ────────────
  fastify.get('/export', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Export audit trail',
      description: 'Exports the audit trail as CSV or JSON.',
      querystring: z.object({
        format: z.enum(['json', 'csv']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        agentId: z.string().optional(),
        category: z.string().optional(),
        includeMetadata: z.string().optional(),
      }),
    },
    preHandler: requirePermission('audit.export'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required' });
      }

      const raw = request.query as any;

      // Validate date params if provided
      if (raw.from && !isValidDate(raw.from)) {
        return reply.code(400).send({ error: 'Invalid "from" date format. Use ISO 8601.' });
      }
      if (raw.to && !isValidDate(raw.to)) {
        return reply.code(400).send({ error: 'Invalid "to" date format. Use ISO 8601.' });
      }

      const params = {
        ...raw,
        format: raw.format || 'csv',
        includeMetadata: raw.includeMetadata === 'true',
      };
      const result = await auditService.export(organizationId, params);

      // Best-effort: audit recording darf nicht den Export killen
      auditService.record({
        organizationId,
        actor: buildUserActor(request),
        category: 'compliance.policy',
        action: 'compliance.audit_export',
        title: `Audit Trail Export (${params.format?.toUpperCase() || 'CSV'})`,
        description: `Audit trail exported as ${params.format || 'csv'}${params.from ? ` from ${params.from}` : ''}${params.to ? ` to ${params.to}` : ''}`,
        riskLevel: 'medium',
        outcome: 'success',
        requestContext: buildRequestContext(request),
      }).catch(err => fastify.log.warn({ err }, '[audit] Failed to record export event'));

      reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.data);
    } catch (err) {
      request.log.error(err, '[audit] Failed to export');
      return reply.code(500).send({ error: 'Failed to export audit trail' });
    }
  });

  // ── GET /api/audit/report - Compliance Report generieren ───────
  fastify.get('/report', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Generate compliance report',
      description: 'Generates a comprehensive compliance report for a given time period.',
      querystring: z.object({
        from: z.string().describe('Start date (ISO 8601)'),
        to: z.string().describe('End date (ISO 8601)'),
      }),
    },
    preHandler: requirePermission('audit.export'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required' });
      }

      const { from, to } = request.query as any;
      if (!from || !to) {
        return reply.code(400).send({ error: 'Both "from" and "to" query parameters are required' });
      }
      if (!isValidDate(from) || !isValidDate(to)) {
        return reply.code(400).send({ error: 'Invalid date format. Use ISO 8601.' });
      }

      const report = await auditService.generateComplianceReport(organizationId, from, to);
      return serializeDoc(report);
    } catch (err) {
      request.log.error(err, '[audit] Failed to generate report');
      return reply.code(500).send({ error: 'Failed to generate compliance report' });
    }
  });

  // ── GET /api/audit/:id - Einzelnen Eintrag abrufen ─────────────
  // IMPORTANT: Parametric route registered LAST to avoid catching static routes
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Audit & Compliance'],
      summary: 'Get single audit entry',
      description: 'Returns a single audit trail entry by ID.',
      params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/),
      }),
    },
    preHandler: requirePermission('audit.view'),
  }, async (request, reply) => {
    try {
      const organizationId = request.organizationId;
      if (!organizationId) {
        return reply.code(403).send({ error: 'Organization context required' });
      }

      const entry = await auditService.getById(organizationId, request.params.id);
      if (!entry) {
        return reply.code(404).send({ error: 'Audit entry not found' });
      }

      return { entry: serializeDoc(entry) };
    } catch (err) {
      request.log.error(err, '[audit] Failed to get entry');
      return reply.code(500).send({ error: 'Failed to get audit entry' });
    }
  });
}
