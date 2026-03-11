// ── Actionable Compliance: Revisionssicherer Audit Service ──────
// Hash-Chain (SHA-256) für Tamper Detection.
// Jeder Eintrag referenziert den Hash des vorherigen.
// Immutable: Kein Update, nur Append + Read.

import crypto from 'crypto';
import { getDatabase } from '../config/database.js';
import type { Collection, Db } from 'mongodb';
import type {
  AuditEntry,
  CreateAuditEntryInput,
  AuditQueryParams,
  AuditListResponse,
  AuditIntegrityResult,
  AuditComplianceReport,
  AuditStatsResponse,
  AuditExportRequest,
} from '@openclaw-business/shared';

// Per-Org Mutex: verhindert Race Conditions bei gleichzeitigen Hash-Chain Writes.
// Ohne Mutex können zwei parallele record() Calls denselben previousHash bekommen,
// was die Chain forkt und Integrity Checks bricht.
const orgLocks = new Map<string, Promise<any>>();

function withOrgLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = orgLocks.get(organizationId) || Promise.resolve();
  const next = prev.then(fn, fn);
  orgLocks.set(organizationId, next);
  // Cleanup wenn Chain abgearbeitet (verhindert Memory Leak)
  next.finally(() => {
    if (orgLocks.get(organizationId) === next) {
      orgLocks.delete(organizationId);
    }
  });
  return next;
}

/** Escape regex metacharacters to prevent ReDoS */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class AuditService {
  private getCollection(): Collection<AuditEntry> {
    return getDatabase().collection<AuditEntry>('audit_trail');
  }

  // ── Hash Chain ──────────────────────────────────────────────────

  /**
   * Berechnet den SHA-256 Hash eines Audit-Eintrags.
   * Deterministisch: gleiche Daten = gleicher Hash.
   * Enthält previousHash für Verkettung.
   * Alle payload-relevanten Felder inkl. agentName, retentionPeriod, expiresAt.
   */
  private computeHash(entry: Omit<AuditEntry, '_id' | 'entryHash'>): string {
    const payload = JSON.stringify({
      organizationId: entry.organizationId,
      agentId: entry.agentId,
      agentName: entry.agentName,
      actor: entry.actor,
      category: entry.category,
      action: entry.action,
      title: entry.title,
      description: entry.description,
      reasoning: entry.reasoning,
      riskLevel: entry.riskLevel,
      outcome: entry.outcome,
      resource: entry.resource,
      changes: entry.changes,
      metadata: entry.metadata,
      policy: entry.policy,
      sessionContext: entry.sessionContext,
      requestContext: entry.requestContext,
      previousHash: entry.previousHash,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
      retentionPeriod: entry.retentionPeriod,
      expiresAt: entry.expiresAt instanceof Date ? entry.expiresAt.toISOString() : entry.expiresAt,
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Holt den Hash des letzten Eintrags einer Organisation.
   * Null wenn keine Einträge existieren (Genesis-Eintrag).
   * Sort by timestamp DESC + _id DESC für deterministische Reihenfolge bei Timestamp-Kollisionen.
   */
  private async getLastHash(organizationId: string): Promise<string | null> {
    const last = await this.getCollection()
      .find({ organizationId })
      .sort({ timestamp: -1, _id: -1 })
      .limit(1)
      .project({ entryHash: 1 })
      .toArray();
    return last.length > 0 ? (last[0] as any).entryHash : null;
  }

  // ── Core: Audit Event aufzeichnen ──────────────────────────────

  /**
   * Zeichnet einen neuen Audit-Eintrag auf.
   * Thread-safe durch Per-Org Mutex (verhindert Hash-Chain Forks).
   */
  async record(input: CreateAuditEntryInput): Promise<AuditEntry> {
    return withOrgLock(input.organizationId, async () => {
      const collection = this.getCollection();
      const previousHash = await this.getLastHash(input.organizationId);
      const timestamp = new Date();

      // Default Retention: 7 Jahre (DSGVO/GoBD-konform)
      const retentionPeriod = 'P7Y';
      const expiresAt = new Date(timestamp);
      expiresAt.setFullYear(expiresAt.getFullYear() + 7);

      const entry: Omit<AuditEntry, '_id' | 'entryHash'> = {
        organizationId: input.organizationId,
        agentId: input.agentId,
        agentName: input.agentName,
        actor: input.actor,
        category: input.category,
        action: input.action,
        title: input.title,
        description: input.description,
        reasoning: input.reasoning,
        riskLevel: input.riskLevel,
        outcome: input.outcome,
        resource: input.resource,
        changes: input.changes,
        metadata: input.metadata,
        policy: input.policy,
        sessionContext: input.sessionContext,
        requestContext: input.requestContext,
        previousHash,
        timestamp,
        retentionPeriod,
        expiresAt,
      };

      const entryHash = this.computeHash(entry);
      const fullEntry: AuditEntry = { ...entry, entryHash };

      const result = await collection.insertOne(fullEntry as any);
      return { ...fullEntry, _id: result.insertedId };
    });
  }

  // ── Abfragen ───────────────────────────────────────────────────

  async query(organizationId: string, params: AuditQueryParams): Promise<AuditListResponse> {
    const collection = this.getCollection();
    const filter: any = { organizationId };

    if (params.agentId) filter.agentId = params.agentId;
    if (params.category) filter.category = params.category;
    if (params.action) filter.action = params.action;
    if (params.riskLevel) filter.riskLevel = params.riskLevel;
    if (params.outcome) filter.outcome = params.outcome;
    if (params.actorType) filter['actor.type'] = params.actorType;

    if (params.from || params.to) {
      filter.timestamp = {};
      if (params.from) filter.timestamp.$gte = new Date(params.from);
      if (params.to) filter.timestamp.$lte = new Date(params.to);
    }

    if (params.search) {
      const escaped = escapeRegex(params.search);
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { reasoning: { $regex: escaped, $options: 'i' } },
      ];
    }

    const limit = Math.min(params.limit || 50, 500);
    const offset = Math.max(params.offset || 0, 0);

    const [entries, total] = await Promise.all([
      collection.find(filter).sort({ timestamp: -1 }).skip(offset).limit(limit).toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      entries: entries as AuditEntry[],
      total,
      integrityStatus: 'unchecked',
    };
  }

  async getById(organizationId: string, entryId: string): Promise<AuditEntry | null> {
    const { ObjectId } = await import('mongodb');
    return this.getCollection().findOne({
      _id: new ObjectId(entryId),
      organizationId,
    }) as Promise<AuditEntry | null>;
  }

  // ── Integritätsprüfung ─────────────────────────────────────────

  /**
   * Verifiziert die Hash-Chain einer Organisation.
   * Prüft jeden Eintrag sequentiell: Stimmt der Hash?
   * Referenziert der previousHash den tatsächlichen Vorgänger?
   */
  async verifyIntegrity(
    organizationId: string,
    options?: { limit?: number }
  ): Promise<AuditIntegrityResult> {
    const collection = this.getCollection();
    const limit = options?.limit || 10000;

    const entries = await collection
      .find({ organizationId })
      .sort({ timestamp: 1, _id: 1 })
      .limit(limit)
      .toArray();

    if (entries.length === 0) {
      return { status: 'valid', checkedEntries: 0 };
    }

    let previousHash: string | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Prüfe 1: previousHash muss mit dem letzten Hash übereinstimmen
      if (entry.previousHash !== previousHash) {
        return {
          status: 'broken',
          checkedEntries: i,
          firstEntry: entries[0]._id!.toString(),
          lastEntry: entries[entries.length - 1]._id!.toString(),
          brokenAt: {
            entryId: entry._id!.toString(),
            expectedHash: previousHash || '(null - genesis)',
            actualHash: entry.previousHash || '(null)',
            timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
          },
        };
      }

      // Prüfe 2: entryHash muss korrekt berechnet sein
      // Explizit nur die Hash-relevanten Felder extrahieren (nicht ...rest spread)
      const hashInput: Omit<AuditEntry, '_id' | 'entryHash'> = {
        organizationId: entry.organizationId,
        agentId: entry.agentId,
        agentName: entry.agentName,
        actor: entry.actor,
        category: entry.category,
        action: entry.action,
        title: entry.title,
        description: entry.description,
        reasoning: entry.reasoning,
        riskLevel: entry.riskLevel,
        outcome: entry.outcome,
        resource: entry.resource,
        changes: entry.changes,
        metadata: entry.metadata,
        policy: entry.policy,
        sessionContext: entry.sessionContext,
        requestContext: entry.requestContext,
        previousHash: entry.previousHash,
        timestamp: entry.timestamp,
        retentionPeriod: entry.retentionPeriod,
        expiresAt: entry.expiresAt,
      };
      const computedHash = this.computeHash(hashInput);
      if (computedHash !== entry.entryHash) {
        return {
          status: 'broken',
          checkedEntries: i,
          firstEntry: entries[0]._id!.toString(),
          lastEntry: entries[entries.length - 1]._id!.toString(),
          brokenAt: {
            entryId: entry._id!.toString(),
            expectedHash: computedHash,
            actualHash: entry.entryHash,
            timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
          },
        };
      }

      previousHash = entry.entryHash;
    }

    return {
      status: 'valid',
      checkedEntries: entries.length,
      firstEntry: entries[0]._id!.toString(),
      lastEntry: entries[entries.length - 1]._id!.toString(),
    };
  }

  // ── Export ─────────────────────────────────────────────────────

  async export(
    organizationId: string,
    params: AuditExportRequest
  ): Promise<{ data: string; contentType: string; filename: string }> {
    const collection = this.getCollection();
    const filter: any = { organizationId };

    if (params.from) filter.timestamp = { ...filter.timestamp, $gte: new Date(params.from) };
    if (params.to) filter.timestamp = { ...filter.timestamp, $lte: new Date(params.to) };
    if (params.agentId) filter.agentId = params.agentId;
    if (params.category) filter.category = params.category;

    const entries = await collection.find(filter).sort({ timestamp: 1 }).toArray();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (params.format === 'csv') {
      const headers = [
        'timestamp', 'action', 'category', 'title', 'description', 'reasoning',
        'riskLevel', 'outcome', 'actorType', 'actorId', 'agentId', 'agentName',
        'resourceType', 'resourceId', 'entryHash', 'previousHash',
      ];

      // RFC 4180: alle Felder quoten für Sicherheit (Kommas, Newlines, Quotes in Free-Text Feldern)
      const csvQuote = (val: string): string => `"${val.replace(/"/g, '""')}"`;

      const rows = entries.map(e => [
        csvQuote(e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp || '')),
        csvQuote(e.action || ''),
        csvQuote(e.category || ''),
        csvQuote(e.title || ''),
        csvQuote(e.description || ''),
        csvQuote(e.reasoning || ''),
        csvQuote(e.riskLevel || ''),
        csvQuote(e.outcome || ''),
        csvQuote(e.actor?.type || ''),
        csvQuote((e.actor as any)?.userId || (e.actor as any)?.agentId || (e.actor as any)?.component || ''),
        csvQuote(e.agentId || ''),
        csvQuote(e.agentName || ''),
        csvQuote(e.resource?.type || ''),
        csvQuote(e.resource?.id || ''),
        csvQuote(e.entryHash || ''),
        csvQuote(e.previousHash || ''),
      ].join(','));

      // UTF-8 BOM für korrekte Darstellung in Excel
      const bom = '\uFEFF';
      return {
        data: bom + [headers.join(','), ...rows].join('\n'),
        contentType: 'text/csv; charset=utf-8',
        filename: `audit-trail-${timestamp}.csv`,
      };
    }

    // JSON export
    const exportData = {
      exportedAt: new Date().toISOString(),
      organizationId,
      filters: params,
      totalEntries: entries.length,
      entries: params.includeMetadata
        ? entries
        : entries.map(({ metadata, ...rest }) => rest),
    };

    return {
      data: JSON.stringify(exportData, null, 2),
      contentType: 'application/json',
      filename: `audit-trail-${timestamp}.json`,
    };
  }

  // ── Compliance Report ──────────────────────────────────────────

  async generateComplianceReport(
    organizationId: string,
    from: string,
    to: string
  ): Promise<AuditComplianceReport> {
    const collection = this.getCollection();
    const filter = {
      organizationId,
      timestamp: { $gte: new Date(from), $lte: new Date(to) },
    };

    const entries = await collection.find(filter).sort({ timestamp: 1 }).toArray();

    // Aggregiere nach Kategorie
    const byCategory: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    const byOutcome: Record<string, number> = { success: 0, failure: 0, denied: 0, partial: 0, pending: 0 };
    const byActorType: Record<string, number> = {};
    const agentMap = new Map<string, { name: string; count: number; risk: Record<string, number> }>();

    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      byRiskLevel[entry.riskLevel] = (byRiskLevel[entry.riskLevel] || 0) + 1;
      byOutcome[entry.outcome] = (byOutcome[entry.outcome] || 0) + 1;
      byActorType[entry.actor.type] = (byActorType[entry.actor.type] || 0) + 1;

      if (entry.agentId) {
        const existing = agentMap.get(entry.agentId) || {
          name: entry.agentName || entry.agentId,
          count: 0,
          risk: { low: 0, medium: 0, high: 0, critical: 0 },
        };
        existing.count++;
        existing.risk[entry.riskLevel] = (existing.risk[entry.riskLevel] || 0) + 1;
        agentMap.set(entry.agentId, existing);
      }
    }

    const highRiskActions = entries.filter(
      e => e.riskLevel === 'high' || e.riskLevel === 'critical'
    );
    const failedActions = entries.filter(
      e => e.outcome === 'failure' || e.outcome === 'denied'
    );

    // Integrity check (letzte 10000 Einträge)
    const chainIntegrity = await this.verifyIntegrity(organizationId, { limit: 10000 });

    return {
      generatedAt: new Date().toISOString(),
      organizationId,
      period: { from, to },
      summary: {
        totalEntries: entries.length,
        byCategory,
        byRiskLevel: byRiskLevel as any,
        byOutcome: byOutcome as any,
        byActorType,
      },
      highRiskActions: highRiskActions.slice(0, 100) as AuditEntry[],
      failedActions: failedActions.slice(0, 100) as AuditEntry[],
      chainIntegrity: {
        status: chainIntegrity.status,
        checkedEntries: chainIntegrity.checkedEntries,
        brokenAt: chainIntegrity.brokenAt?.entryId,
      },
      agents: Array.from(agentMap.entries()).map(([agentId, data]) => ({
        agentId,
        agentName: data.name,
        actionCount: data.count,
        riskProfile: data.risk as any,
      })),
    };
  }

  // ── Statistiken ────────────────────────────────────────────────

  async getStats(organizationId: string): Promise<AuditStatsResponse> {
    const collection = this.getCollection();
    const now = new Date();
    const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const month = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [total, last24h, last7d, last30d] = await Promise.all([
      collection.countDocuments({ organizationId }),
      collection.countDocuments({ organizationId, timestamp: { $gte: day } }),
      collection.countDocuments({ organizationId, timestamp: { $gte: week } }),
      collection.countDocuments({ organizationId, timestamp: { $gte: month } }),
    ]);

    // Top Actions (letzte 30 Tage)
    const topActionsPipeline = [
      { $match: { organizationId, timestamp: { $gte: month } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 as const } },
      { $limit: 10 },
    ];
    const topActionsResult = await collection.aggregate(topActionsPipeline).toArray();
    const topActions = topActionsResult.map(r => ({ action: r._id as string, count: r.count as number }));

    // Risk Distribution
    const riskPipeline = [
      { $match: { organizationId } },
      { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
    ];
    const riskResult = await collection.aggregate(riskPipeline).toArray();
    const riskDistribution: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const r of riskResult) {
      riskDistribution[r._id as string] = r.count as number;
    }

    // Actor Distribution
    const actorPipeline = [
      { $match: { organizationId } },
      { $group: { _id: '$actor.type', count: { $sum: 1 } } },
    ];
    const actorResult = await collection.aggregate(actorPipeline).toArray();
    const actorDistribution: Record<string, number> = {};
    for (const r of actorResult) {
      actorDistribution[r._id as string] = r.count as number;
    }

    return {
      totalEntries: total,
      last24h,
      last7d,
      last30d,
      topActions,
      riskDistribution: riskDistribution as any,
      actorDistribution,
      chainIntegrity: 'unchecked',
    };
  }

  // ── Database Setup ─────────────────────────────────────────────

  async ensureIndexes(): Promise<void> {
    const collection = this.getCollection();
    await Promise.all([
      collection.createIndex({ organizationId: 1, timestamp: -1 }),
      collection.createIndex({ organizationId: 1, agentId: 1, timestamp: -1 }),
      collection.createIndex({ organizationId: 1, category: 1 }),
      collection.createIndex({ organizationId: 1, action: 1 }),
      collection.createIndex({ organizationId: 1, riskLevel: 1 }),
      collection.createIndex({ organizationId: 1, outcome: 1 }),
      collection.createIndex({ organizationId: 1, 'actor.type': 1 }),
      collection.createIndex({ entryHash: 1 }, { unique: true }),
      collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      collection.createIndex(
        { title: 'text', description: 'text', reasoning: 'text' },
        { name: 'audit_text_search' }
      ),
    ]);
  }
}

export const auditService = new AuditService();

// ── Convenience Helpers ──────────────────────────────────────────
// Für einfache Integration in bestehende Route-Handler.

export function buildUserActor(request: any): Extract<import('@openclaw-business/shared').AuditActor, { type: 'user' }> {
  return {
    type: 'user',
    userId: request.userId,
    ip: request.ip,
  };
}

export function buildRequestContext(request: any): import('@openclaw-business/shared').AuditEntry['requestContext'] {
  return {
    method: request.method,
    path: request.url,
    ip: request.ip,
    userAgent: request.headers?.['user-agent'],
  };
}
