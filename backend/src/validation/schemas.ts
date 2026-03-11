import { z } from 'zod';

// All valid channel types (matches ChannelType in @openclaw-business/shared)
const channelTypes = [
  'whatsapp', 'telegram', 'discord', 'slack', 'signal',
  'imessage', 'webchat', 'googlechat', 'msteams',
  'mattermost', 'matrix', 'feishu', 'line', 'bluebubbles', 'superchat',
] as const;

// Agent Schemas
export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  useCase: z.enum(['sales', 'support', 'marketing', 'operations', 'finance', 'general']),
  model: z.string().min(1),
  systemPrompt: z.string().max(15000).optional(),
  skills: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  templateId: z.string().optional(),
});

/** Architect config format — maps to CreateAgentRequest for new agents */
export const architectConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  useCase: z.enum(['sales', 'support', 'marketing', 'operations', 'finance', 'general']),
  model: z.string().min(1),
  systemPrompt: z.string().max(15000).optional(),
  skills: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  suggestedTemplate: z.string().nullable().optional(),
  suggestMcpConnections: z.array(z.object({
    mcpUrl: z.string(),
    mcpName: z.string(),
  })).optional(),
  missions: z.array(z.object({
    type: z.enum(['cron', 'reactive', 'heartbeat']).optional(),
    name: z.string().optional(),
    schedule: z.string().optional(),
    every: z.string().optional(),
    trigger: z.string().optional(),
    instruction: z.string(),
    /** New: one mission per use case with multiple triggers */
    triggers: z.array(z.object({
      id: z.string(),
      schedule: z.string().optional(),
      every: z.string().optional(),
      /** IANA timezone for schedule (e.g. Europe/Berlin). Use when user says "8:00 morgens" or "Freitag 17:00" */
      tz: z.string().optional(),
    })).optional(),
  })).optional(),
});

// Session Schemas
export const createSessionSchema = z.object({
  agentId: z.string().min(1),
  channelType: z.enum([...channelTypes, 'web', 'api'] as const),
  channelUserId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});

// Channel Schemas
export const createChannelSchema = z.object({
  type: z.enum(channelTypes),
  name: z.string().min(1).max(100),
  credentials: z.record(z.any()),
  config: z.record(z.any()).optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['connected', 'disconnected']).optional(),
  config: z.record(z.any()).optional(),
});

// User Schemas
export const updateUserSchema = z.object({
  settings: z.record(z.any()).optional(),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

// Log Schemas
export const createLogSchema = z.object({
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  level: z.enum(['info', 'warning', 'error', 'debug']),
  message: z.string().min(1).max(1000),
  metadata: z.record(z.any()).optional(),
});

// Query Schemas
export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const logQuerySchema = paginationSchema.extend({
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  level: z.enum(['info', 'warning', 'warn', 'error', 'debug']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// MongoDB ObjectId validation
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

// Validation helper
export function validateObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}
