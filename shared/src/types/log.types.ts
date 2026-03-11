import { ObjectId } from 'mongodb';

export interface Log {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  agentId?: string;
  sessionId?: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  metadata?: any;
  createdAt: Date;
}

export interface LogQuery {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  level?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}
