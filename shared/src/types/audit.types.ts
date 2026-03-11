import { ObjectId } from 'mongodb';

// ── Actionable Compliance: Revisionssicherer Audit Trail ────────
// Jeder autonome Schritt wird mit Hash-Chain dokumentiert.
// Immutable by design - kein Update, nur Append.

/** Wer hat die Aktion ausgelöst? */
export type AuditActor =
  | { type: 'user'; userId: string; email?: string; name?: string; ip?: string }
  | { type: 'agent'; agentId: string; agentName?: string; sessionId?: string }
  | { type: 'system'; component: string }
  | { type: 'cron'; jobId: string; jobName?: string }
  | { type: 'webhook'; webhookId: string; source?: string }
  | { type: 'api_key'; keyId: string; keyName?: string; userId: string };

/** Kategorien autonomer Aktionen */
export type AuditActionCategory =
  | 'agent.lifecycle'
  | 'agent.config'
  | 'agent.deployment'
  | 'agent.channel'
  | 'agent.workspace'
  | 'agent.skill'
  | 'agent.workflow'
  | 'session.management'
  | 'message.autonomous'
  | 'tool.execution'
  | 'billing.action'
  | 'security.access'
  | 'security.change'
  | 'data.modification'
  | 'integration.action'
  | 'compliance.policy'
  | 'user.management'
  | 'org.management';

/** Spezifische Aktionstypen */
export type AuditAction =
  // Agent Lifecycle
  | 'agent.created'
  | 'agent.deployed'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.deleted'
  | 'agent.restarted'
  | 'agent.redeployed'
  // Agent Config
  | 'agent.config.updated'
  | 'agent.config.model_changed'
  | 'agent.config.tools_changed'
  | 'agent.config.sandbox_changed'
  // Channels
  | 'agent.channel.connected'
  | 'agent.channel.disconnected'
  | 'agent.channel.credentials_updated'
  // Workspace
  | 'agent.workspace.file_written'
  | 'agent.workspace.persona_updated'
  | 'agent.workspace.memory_modified'
  // Skills
  | 'agent.skill.installed'
  | 'agent.skill.removed'
  | 'agent.skill.security_scan'
  // Workflows
  | 'agent.workflow.created'
  | 'agent.workflow.executed'
  | 'agent.workflow.approval_granted'
  | 'agent.workflow.approval_denied'
  // Sessions & Messages
  | 'session.created'
  | 'session.ended'
  | 'session.compacted'
  | 'message.sent_autonomous'
  | 'message.handoff_to_human'
  | 'message.handoff_to_ai'
  // Tool Execution
  | 'tool.exec_command'
  | 'tool.exec_approved'
  | 'tool.exec_denied'
  | 'tool.web_fetch'
  | 'tool.file_modified'
  | 'tool.browser_action'
  // Billing
  | 'billing.invoice_approved'
  | 'billing.payment_processed'
  | 'billing.subscription_changed'
  | 'billing.refund_issued'
  | 'billing.basis_checkout_created'
  // Security
  | 'security.login'
  | 'security.api_key_created'
  | 'security.api_key_revoked'
  | 'security.permission_changed'
  | 'security.provider_key_added'
  | 'security.provider_key_removed'
  | 'security.pairing_approved'
  | 'security.pairing_rejected'
  // Data
  | 'data.export_requested'
  | 'data.contact_modified'
  | 'data.knowledge_added'
  | 'data.knowledge_removed'
  // Integration
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.webhook_fired'
  // Compliance
  | 'compliance.audit_export'
  | 'compliance.integrity_check'
  | 'compliance.retention_applied';

/** Risikostufe einer Aktion */
export type AuditRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Ergebnis einer Aktion */
export type AuditOutcome = 'success' | 'failure' | 'denied' | 'partial' | 'pending';

/** Ein einzelner Audit-Trail-Eintrag (immutable) */
export interface AuditEntry {
  _id?: ObjectId;
  /** Organisations-Kontext */
  organizationId: string;
  /** Optionaler Agent-Bezug */
  agentId?: string;
  agentName?: string;
  /** Wer hat die Aktion ausgelöst */
  actor: AuditActor;
  /** Aktionskategorie (für Filterung) */
  category: AuditActionCategory;
  /** Spezifische Aktion */
  action: AuditAction;
  /** Menschenlesbarer Titel */
  title: string;
  /** Detailbeschreibung: Was wurde gemacht und WARUM */
  description: string;
  /** Reasoning: Warum hat der Agent/System diese Entscheidung getroffen */
  reasoning?: string;
  /** Risikostufe */
  riskLevel: AuditRiskLevel;
  /** Ergebnis der Aktion */
  outcome: AuditOutcome;
  /** Betroffene Ressource */
  resource?: {
    type: string;
    id: string;
    name?: string;
  };
  /** Was hat sich geändert (vorher/nachher) */
  changes?: {
    field: string;
    before: any;
    after: any;
  }[];
  /** Zusätzliche Metadaten (Tool-Output, Config-Snapshots, etc.) */
  metadata?: Record<string, any>;
  /** Policy/Regelwerk das angewendet wurde */
  policy?: {
    name: string;
    version?: string;
    rule?: string;
  };
  /** Session-Kontext (wenn aus Agent-Session) */
  sessionContext?: {
    sessionId: string;
    messageCount?: number;
    model?: string;
    tokenUsage?: number;
  };
  /** Request-Kontext (HTTP, falls vorhanden) */
  requestContext?: {
    method?: string;
    path?: string;
    ip?: string;
    userAgent?: string;
  };
  /** Hash des vorherigen Eintrags (Tamper Detection) */
  previousHash: string | null;
  /** SHA-256 Hash dieses Eintrags */
  entryHash: string;
  /** Zeitstempel (UTC, unveränderlich) */
  timestamp: Date;
  /** Aufbewahrungsfrist (ISO 8601 Duration, z.B. "P7Y" = 7 Jahre) */
  retentionPeriod?: string;
  /** Ablaufdatum basierend auf Retention Policy */
  expiresAt?: Date;
}

// ── API Request/Response Types ─────────────────────────────────

export interface AuditQueryParams {
  agentId?: string;
  category?: AuditActionCategory;
  action?: AuditAction;
  riskLevel?: AuditRiskLevel;
  outcome?: AuditOutcome;
  actorType?: AuditActor['type'];
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  integrityStatus: 'valid' | 'broken' | 'unchecked';
}

export interface AuditExportRequest {
  format: 'json' | 'csv';
  from?: string;
  to?: string;
  agentId?: string;
  category?: AuditActionCategory;
  includeMetadata?: boolean;
}

export interface AuditComplianceReport {
  generatedAt: string;
  organizationId: string;
  period: { from: string; to: string };
  summary: {
    totalEntries: number;
    byCategory: Record<string, number>;
    byRiskLevel: Record<AuditRiskLevel, number>;
    byOutcome: Record<AuditOutcome, number>;
    byActorType: Record<string, number>;
  };
  highRiskActions: AuditEntry[];
  failedActions: AuditEntry[];
  chainIntegrity: {
    status: 'valid' | 'broken';
    checkedEntries: number;
    brokenAt?: string;
  };
  agents: {
    agentId: string;
    agentName: string;
    actionCount: number;
    riskProfile: Record<AuditRiskLevel, number>;
  }[];
}

export interface AuditIntegrityResult {
  status: 'valid' | 'broken';
  checkedEntries: number;
  firstEntry?: string;
  lastEntry?: string;
  brokenAt?: {
    entryId: string;
    expectedHash: string;
    actualHash: string;
    timestamp: string;
  };
}

export interface AuditStatsResponse {
  totalEntries: number;
  last24h: number;
  last7d: number;
  last30d: number;
  topActions: { action: string; count: number }[];
  riskDistribution: Record<AuditRiskLevel, number>;
  actorDistribution: Record<string, number>;
  chainIntegrity: 'valid' | 'broken' | 'unchecked';
}

/** Helper: Erstellt ein AuditEntry für den Service (ohne Hash-Felder) */
export interface CreateAuditEntryInput {
  organizationId: string;
  agentId?: string;
  agentName?: string;
  actor: AuditActor;
  category: AuditActionCategory;
  action: AuditAction;
  title: string;
  description: string;
  reasoning?: string;
  riskLevel: AuditRiskLevel;
  outcome: AuditOutcome;
  resource?: AuditEntry['resource'];
  changes?: AuditEntry['changes'];
  metadata?: Record<string, any>;
  policy?: AuditEntry['policy'];
  sessionContext?: AuditEntry['sessionContext'];
  requestContext?: AuditEntry['requestContext'];
}
