// ── Audit Trail Fastify Plugin ───────────────────────────────────
// Dekoriert jeden Request mit request.audit() für einfache Integration.
// Fire-and-forget: Audit-Fehler blocken nie den Request.
//
// Wrapped with fastify-plugin (fp) to break Fastify encapsulation:
// Without fp, decorateRequest + addHook are scoped to the plugin's
// own child context and invisible to sibling route plugins.

import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { auditService, buildUserActor, buildRequestContext } from '../services/audit.service.js';
import type { CreateAuditEntryInput, AuditActionCategory, AuditAction, AuditRiskLevel, AuditOutcome } from '@openclaw-business/shared';

export interface AuditOptions {
  agentId?: string;
  agentName?: string;
  category: AuditActionCategory;
  action: AuditAction;
  title: string;
  description: string;
  reasoning?: string;
  riskLevel: AuditRiskLevel;
  outcome: AuditOutcome;
  resource?: CreateAuditEntryInput['resource'];
  changes?: CreateAuditEntryInput['changes'];
  metadata?: Record<string, any>;
  policy?: CreateAuditEntryInput['policy'];
  sessionContext?: CreateAuditEntryInput['sessionContext'];
}

declare module 'fastify' {
  interface FastifyRequest {
    audit(options: AuditOptions): Promise<void>;
  }
}

export const auditPlugin = fp(async function auditPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('audit', null as any);

  fastify.addHook('onRequest', async (request) => {
    request.audit = async (options: AuditOptions) => {
      try {
        const organizationId = request.organizationId;
        if (!organizationId) return;

        await auditService.record({
          organizationId,
          agentId: options.agentId,
          agentName: options.agentName,
          actor: buildUserActor(request),
          category: options.category,
          action: options.action,
          title: options.title,
          description: options.description,
          reasoning: options.reasoning,
          riskLevel: options.riskLevel,
          outcome: options.outcome,
          resource: options.resource,
          changes: options.changes,
          metadata: options.metadata,
          policy: options.policy,
          sessionContext: options.sessionContext,
          requestContext: buildRequestContext(request),
        });
      } catch (err) {
        // Audit darf nie den Request blocken
        fastify.log.warn({ err }, '[audit] Failed to record audit event');
      }
    };
  });
});
