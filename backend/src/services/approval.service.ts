// ── Approval Service ─────────────────────────────────────────────
// Business-level approval gates for agent actions.
// Agent requests approval via webhook → stored in MongoDB → user resolves → agent notified.

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { gatewayManager } from './gateway-ws.service.js';
import type {
  ApprovalRequest,
  CreateApprovalRequest,
  ResolveApprovalRequest,
  ApprovalCounts,
  ApprovalListResponse,
} from '@openclaw-business/shared';

export class ApprovalService {
  private get collection() {
    return getDatabase().collection<ApprovalRequest>('approvals');
  }

  /** Ensure indexes on first use */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ organizationId: 1, status: 1, createdAt: -1 });
    await this.collection.createIndex({ agentId: 1, status: 1 });
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  /** Create a new approval request (called by agent webhook) */
  async createApproval(
    organizationId: string,
    data: CreateApprovalRequest,
  ): Promise<ApprovalRequest> {
    const now = new Date();
    const ttl = data.ttlMinutes ?? 60;
    const expiresAt = new Date(now.getTime() + ttl * 60_000);

    const doc: ApprovalRequest = {
      agentId: data.agentId,
      organizationId,
      sessionKey: data.sessionKey,
      channel: data.channel,
      actionType: data.actionType,
      title: data.title,
      description: data.description,
      payload: data.payload,
      confidence: data.confidence,
      priority: data.priority ?? 'medium',
      status: 'pending',
      expiresAt,
      createdAt: now,
    };

    const result = await this.collection.insertOne(doc as any);
    return { ...doc, _id: result.insertedId.toString() };
  }

  /** List approvals for an organization */
  async listApprovals(
    organizationId: string,
    params: { status?: string; agentId?: string; limit?: number; offset?: number },
  ): Promise<ApprovalListResponse> {
    const filter: any = { organizationId };
    if (params.status) filter.status = params.status;
    if (params.agentId) filter.agentId = params.agentId;

    const limit = Number.isFinite(params.limit) ? params.limit! : 50;
    const offset = Number.isFinite(params.offset) ? params.offset! : 0;

    const [rawApprovals, total, counts] = await Promise.all([
      this.collection
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .toArray(),
      this.collection.countDocuments(filter),
      this.getCounts(organizationId),
    ]);

    const approvals = rawApprovals.map((a: any) => ({
      ...a,
      _id: a._id!.toString(),
      createdAt: new Date(a.createdAt).toISOString(),
      resolvedAt: a.resolvedAt ? new Date(a.resolvedAt).toISOString() : undefined,
      expiresAt: a.expiresAt ? new Date(a.expiresAt as any).toISOString() : undefined,
    }));

    return { approvals: approvals as any, total, counts };
  }

  /** Get a single approval by ID */
  async getApproval(id: string, organizationId: string): Promise<ApprovalRequest | null> {
    const doc = await this.collection.findOne({
      _id: new ObjectId(id) as any,
      organizationId,
    });
    if (!doc) return null;
    return {
      ...doc,
      _id: doc._id!.toString(),
      createdAt: new Date(doc.createdAt).toISOString(),
      resolvedAt: doc.resolvedAt ? new Date(doc.resolvedAt).toISOString() : undefined,
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt as any).toISOString() : undefined,
    } as any;
  }

  /** Resolve (approve/reject) an approval */
  async resolveApproval(
    id: string,
    organizationId: string,
    userId: string,
    data: ResolveApprovalRequest,
  ): Promise<ApprovalRequest | null> {
    const result = await this.collection.findOneAndUpdate(
      {
        _id: new ObjectId(id) as any,
        organizationId,
        status: 'pending',
      },
      {
        $set: {
          status: data.status,
          resolvedBy: userId,
          resolutionNote: data.note,
          resolvedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );

    const doc = result;
    if (!doc) return null;

    // Notify agent via gateway WebSocket
    this.notifyAgent(doc.agentId, id, data.status, doc.sessionKey).catch(err => {
      console.warn('[approval] notifyAgent failed:', err instanceof Error ? err.message : err);
    });

    return {
      ...doc,
      _id: doc._id!.toString(),
      createdAt: new Date(doc.createdAt).toISOString(),
      resolvedAt: doc.resolvedAt ? new Date(doc.resolvedAt).toISOString() : undefined,
    } as any;
  }

  /** Get approval counts by status */
  async getCounts(organizationId: string): Promise<ApprovalCounts> {
    const pipeline = [
      { $match: { organizationId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];
    const results = await this.collection.aggregate(pipeline).toArray();

    const counts: ApprovalCounts = { pending: 0, approved: 0, rejected: 0, expired: 0, total: 0 };
    for (const r of results) {
      const status = r._id as keyof Omit<ApprovalCounts, 'total'>;
      if (status in counts) (counts as any)[status] = r.count;
      counts.total += r.count;
    }
    return counts;
  }

  /** Notify agent that an approval was resolved */
  private async notifyAgent(
    agentId: string,
    approvalId: string,
    status: string,
    sessionKey?: string,
  ): Promise<void> {
    const client = gatewayManager.getClient(agentId);
    if (!client?.isConnected()) return;

    const message = status === 'approved'
      ? `[APPROVAL GRANTED] Request ${approvalId} was approved. You may proceed with the action.`
      : `[APPROVAL DENIED] Request ${approvalId} was rejected. Do not proceed with the action.`;

    const targetSession = sessionKey || 'system';
    await client.sendMessage(targetSession, message);
  }
}

export const approvalService = new ApprovalService();
