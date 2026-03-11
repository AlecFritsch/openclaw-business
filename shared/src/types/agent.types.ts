// Shared Agent Types

import { ObjectId } from 'mongodb';
import type { ChannelType } from './openclaw.types.js';

export interface Agent {
  _id?: ObjectId;
  userId: string;
  organizationId?: string;
  templateId?: string;
  
  // Basic Info
  name: string;
  description: string;
  useCase: string;
  
  // Status
  status: 'deploying' | 'running' | 'stopped' | 'error';
  errorMessage?: string;
  
  // Deployment
  deploymentType: 'managed';
  containerId?: string;
  internalPort?: number;
  gatewayUrl?: string;
  gatewayToken?: string;
  
  // Config
  config: AgentConfig;
  
  // Team
  team?: AgentTeamMember[];
  
  // Channels
  channels: AgentChannel[];
  
  // Metrics
  metrics: AgentMetrics;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  skills: string[];
  tools: string[];
  temperature?: number;
  maxTokens?: number;
  toolProfile?: string;
  sessionScope?: string;
  sessionResetMode?: string;

  // Extended config fields (persisted to MongoDB alongside above)
  // These are the DB-level store for agent-config.routes.ts PATCH data.
  // The canonical source-of-truth for OpenClaw config is DeploymentConfig,
  // but this interface must accept whatever is saved to the `config` object.
  [key: string]: unknown;
}

export interface AgentTeamMember {
  id?: string;
  userId?: string;
  email: string;
  name?: string;
  role: 'owner' | 'admin' | 'member';
  access: 'full' | 'edit' | 'view';
  addedAt: Date;
}

export interface AgentChannel {
  type: ChannelType;
  status: 'pending' | 'connected' | 'disconnected' | 'error';
  credentials?: {
    botToken?: string;
    appToken?: string;
    phoneNumber?: string;
  };
  connectedAt?: Date;
  lastMessageAt?: Date;
}

export interface AgentMetrics {
  totalMessages: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  lastActive?: Date;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  useCase: string;
  model: string;
  systemPrompt?: string;
  skills?: string[];
  channels?: string[];
  templateId?: string;
  missions?: Array<{
    type?: 'cron' | 'reactive' | 'heartbeat';
    name?: string;
    schedule?: string;
    every?: string;
    trigger?: string;
    instruction: string;
    triggers?: Array<{ id: string; schedule?: string; every?: string }>;
  }>;
}
