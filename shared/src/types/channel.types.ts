import { ObjectId } from 'mongodb';
import type { ChannelType } from './openclaw.types.js';

export interface Channel {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  agentId?: string;
  type: ChannelType | 'email';
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  credentials: {
    /** Stored value in DB is encrypted string; API responses may return boolean mask */
    encrypted: string | boolean;
  };
  config: {
    autoReply?: boolean;
    workingHours?: {
      enabled: boolean;
      timezone: string;
      schedule: Array<{
        day: string;
        start: string;
        end: string;
      }>;
    };
  };
  metrics: {
    totalMessages: number;
    lastMessageAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChannelRequest {
  type: ChannelType | 'email';
  name: string;
  credentials: any;
  config?: any;
}

export interface UpdateChannelRequest {
  name?: string;
  status?: 'connected' | 'disconnected';
  config?: any;
}
