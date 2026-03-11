import { ObjectId } from 'mongodb';
import type { ChannelType } from './openclaw.types.js';

export interface Session {
  _id?: ObjectId;
  agentId: string;
  userId?: string;
  channelType: ChannelType | 'web' | 'api';
  channelUserId?: string;
  status: 'active' | 'ended';
  metadata: {
    userAgent?: string;
    ip?: string;
    location?: string;
  };
  startedAt: Date;
  endedAt?: Date;
  lastMessageAt: Date;
}

export interface Message {
  _id?: ObjectId;
  sessionId: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: {
    model?: string;
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    latency?: number;
    toolCalls?: Array<{
      name: string;
      arguments: any;
      result?: any;
    }>;
  };
  createdAt: Date;
}

export interface CreateSessionRequest {
  agentId: string;
  channelType: ChannelType | 'web' | 'api';
  channelUserId?: string;
  metadata?: any;
}

export interface SendMessageRequest {
  sessionId: string;
  content: string;
}
