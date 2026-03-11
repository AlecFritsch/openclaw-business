// ── Approval System Types ────────────────────────────────────────
// Business-level approval gates for agent actions.
// Agent requests approval → stored in DB → user approves/rejects → agent notified.

/** Action categories that can require approval */
export type ApprovalActionType =
  | 'purchase'          // Agent wants to buy something
  | 'booking'           // Agent wants to book an appointment/reservation
  | 'send_message'      // Agent wants to send an external message (email, SMS)
  | 'contract'          // Agent wants to send/sign a contract
  | 'payment'           // Agent wants to initiate a payment/transfer
  | 'data_export'       // Agent wants to export sensitive data
  | 'account_change'    // Agent wants to modify account settings
  | 'escalation'        // Agent wants to escalate to a human
  | 'custom';           // Custom action type

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export type ApprovalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
  _id?: string;
  /** Agent that requested the approval */
  agentId: string;
  /** Organization owning the agent */
  organizationId: string;
  /** Session key where the request originated */
  sessionKey?: string;
  /** Channel the request came from (whatsapp, telegram, etc.) */
  channel?: string;
  /** Type of action requiring approval */
  actionType: ApprovalActionType;
  /** Human-readable title */
  title: string;
  /** Detailed description of what the agent wants to do */
  description: string;
  /** Structured payload with action-specific data */
  payload?: Record<string, unknown>;
  /** Agent's confidence score (0-1) */
  confidence?: number;
  /** Priority level */
  priority: ApprovalPriority;
  /** Current status */
  status: ApprovalStatus;
  /** User who resolved the approval (approved/rejected) */
  resolvedBy?: string;
  /** Resolution note from the user */
  resolutionNote?: string;
  /** When the approval expires (auto-reject) */
  expiresAt?: Date | string;
  /** Timestamps */
  createdAt: Date | string;
  resolvedAt?: Date | string;
}

/** Request body for creating an approval (from agent webhook) */
export interface CreateApprovalRequest {
  agentId: string;
  sessionKey?: string;
  channel?: string;
  actionType: ApprovalActionType;
  title: string;
  description: string;
  payload?: Record<string, unknown>;
  confidence?: number;
  priority?: ApprovalPriority;
  /** TTL in minutes (default: 60) */
  ttlMinutes?: number;
}

/** Request body for resolving an approval */
export interface ResolveApprovalRequest {
  status: 'approved' | 'rejected';
  note?: string;
}

/** Approval counts for dashboard badge */
export interface ApprovalCounts {
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  total: number;
}

/** List response */
export interface ApprovalListResponse {
  approvals: ApprovalRequest[];
  total: number;
  counts: ApprovalCounts;
}
