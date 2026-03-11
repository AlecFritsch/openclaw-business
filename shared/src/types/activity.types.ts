import { ObjectId } from 'mongodb';

export interface ActivityEvent {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  agentId?: string;
  sessionId?: string;
  type: ActivityEventType;
  title: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export type ActivityEventType =
  | 'agent.created'
  | 'agent.deployed'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.deleted'
  | 'agent.error'
  | 'session.started'
  | 'session.ended'
  | 'message.sent'
  | 'message.received'
  | 'channel.connected'
  | 'channel.disconnected'
  | 'integration.connected'
  | 'integration.disconnected'
  | 'billing.invoice.created'
  | 'billing.payment.received';

export interface OperationsOverview {
  totalAgents: number;
  activeAgents: number;
  errorAgents: number;
  totalMessagesToday: number;
  totalTokens: number;
  alerts: OperationsAlert[];
  agents: OperationsAgentStatus[];
}

export interface OperationsAlert {
  id: string;
  agentId: string;
  agentName: string;
  type: 'error' | 'warning' | 'info';
  message: string;
  createdAt: Date;
}

export interface OperationsAgentStatus {
  agentId: string;
  agentName: string;
  status: string;
  messages: number;
  errors: number;
  uptime?: number;
  lastActive?: Date;
}

export interface SupportTicket {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  messages: SupportMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportMessage {
  id: string;
  userId: string;
  content: string;
  isAgent: boolean; // true = team member, false = external
  createdAt: Date;
}

export interface CreateSupportTicketRequest {
  subject: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface Invoice {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  items: InvoiceItem[];
  dueDate: Date;
  paidAt?: Date;
  createdAt: Date;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PaymentMethod {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  type: 'card' | 'bank_transfer' | 'paypal';
  brand?: string;
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  createdAt: Date;
}
