import { z } from 'zod';

// ── Reusable Primitives ──────────────────────────────────────────

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/).describe('MongoDB ObjectId');
export const dateSchema = z.string().datetime().describe('ISO 8601 datetime');

// ── Standard Error / Success Responses ───────────────────────────

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.any().optional(),
  code: z.string().optional(),
});

export const validationErrorSchema = z.object({
  error: z.literal('Validation failed'),
  details: z.array(z.object({
    code: z.string(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])),
  })),
});

export const planLimitErrorSchema = z.object({
  error: z.literal('Plan limit reached'),
  message: z.string(),
  currentCount: z.number(),
  limit: z.number(),
  plan: z.string(),
});

export const notFoundErrorSchema = z.object({
  error: z.string(),
});

export const successResponseSchema = z.object({
  success: z.literal(true),
});

export const deleteResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
});

// ── Agent Schemas ────────────────────────────────────────────────

// NOTE: use z.record() for all-optional nested objects to avoid
// fast-json-stringify "required must be array" compilation errors
const agentMetricsSchema = z.record(z.any()).optional();

const agentChannelSchema = z.object({
  type: z.string(),
  status: z.enum(['pending', 'connected', 'disconnected', 'error']),
  connectedAt: dateSchema.optional(),
  lastMessageAt: dateSchema.optional(),
});

const agentTeamMemberSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  email: z.string(),
  name: z.string().optional(),
  role: z.enum(['owner', 'admin', 'member']),
  access: z.enum(['full', 'edit', 'view']),
  addedAt: dateSchema,
});

const agentConfigSchema = z.object({
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  toolProfile: z.string().optional(),
  sessionScope: z.string().optional(),
  sessionResetMode: z.string().optional(),
}).passthrough();

export const agentResponseSchema = z.object({
  _id: objectIdSchema,
  userId: z.string(),
  organizationId: z.string().optional(),
  templateId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  useCase: z.string(),
  status: z.enum(['deploying', 'running', 'stopped', 'error']),
  errorMessage: z.string().optional(),
  deploymentType: z.literal('managed'),
  containerId: z.string().optional(),
  internalPort: z.number().optional(),
  config: agentConfigSchema,
  team: z.array(agentTeamMemberSchema).optional(),
  channels: z.array(agentChannelSchema).optional(),
  metrics: agentMetricsSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const listAgentsResponseSchema = z.object({
  agents: z.array(agentResponseSchema),
});

export const getAgentResponseSchema = z.object({
  agent: agentResponseSchema,
});

export const createAgentResponseSchema = z.object({
  agent: agentResponseSchema,
});

// ── Session Schemas ──────────────────────────────────────────────

const messageMetadataSchema = z.record(z.any()).optional();

export const messageSchema = z.object({
  _id: objectIdSchema,
  sessionId: z.string(),
  agentId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  metadata: messageMetadataSchema,
  createdAt: dateSchema,
});

export const sessionResponseSchema = z.object({
  _id: objectIdSchema,
  agentId: z.string(),
  userId: z.string().optional(),
  channelType: z.string(),
  channelUserId: z.string().optional(),
  status: z.enum(['active', 'ended']),
  metadata: z.record(z.any()).optional(),
  startedAt: dateSchema,
  endedAt: dateSchema.optional(),
  lastMessageAt: dateSchema,
});

export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionResponseSchema),
  total: z.number(),
});

export const getSessionResponseSchema = z.object({
  session: sessionResponseSchema,
});

export const sessionMessagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  total: z.number(),
});

export const sendMessageResponseSchema = z.object({
  userMessage: messageSchema,
  assistantMessage: messageSchema,
});

// ── Channel Schemas ──────────────────────────────────────────────

export const channelResponseSchema = z.object({
  _id: objectIdSchema,
  userId: z.string(),
  organizationId: z.string().optional(),
  agentId: z.string().optional(),
  type: z.string(),
  name: z.string(),
  status: z.enum(['connected', 'disconnected', 'error']),
  config: z.record(z.any()).optional(),
  metrics: z.record(z.any()).optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).passthrough();

export const listChannelsResponseSchema = z.object({
  channels: z.array(channelResponseSchema),
});

// ── Analytics Schemas ────────────────────────────────────────────

export const analyticsResponseSchema = z.object({
  totalAgents: z.number(),
  activeAgents: z.number(),
  totalMessages: z.number(),
  totalCost: z.number(),
  totalTokens: z.number(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  messagesByDay: z.array(z.object({ date: z.string(), count: z.number() })),
  costByDay: z.array(z.object({ date: z.string(), cost: z.number() })),
  tokensByDay: z.array(z.object({ date: z.string(), tokens: z.number() })),
  agentPerformance: z.array(z.object({
    agentId: z.string(),
    name: z.string(),
    status: z.string(),
    useCase: z.string(),
    messages: z.number(),
    cost: z.number(),
    tokens: z.number(),
    lastActive: z.string().optional(),
  })),
});

export const agentAnalyticsResponseSchema = z.object({
  sessions: z.number(),
  messages: z.number(),
  errors: z.number(),
  timeseries: z.array(z.object({
    date: z.string(),
    messages: z.number(),
    sessions: z.number(),
    errors: z.number(),
  })),
});

// ── User Schemas ─────────────────────────────────────────────────

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string().describe('Masked key (only last 4 chars visible)'),
  createdAt: dateSchema,
  lastUsed: dateSchema.optional(),
});

export const userResponseSchema = z.object({
  _id: objectIdSchema,
  clerkId: z.string(),
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  imageUrl: z.string().optional(),
  organizationId: z.string().optional(),
  // settings, subscription, apiKeys are REQUIRED — handlers must provide defaults
  settings: z.object({
    notifications: z.boolean(),
    theme: z.enum(['light', 'dark', 'system']),
    language: z.string(),
  }),
  subscription: z.object({
    plan: z.enum(['unpaid', 'professional', 'enterprise']),
    status: z.enum(['active', 'canceled', 'past_due']),
    currentPeriodEnd: dateSchema.optional(),
  }),
  apiKeys: z.array(apiKeySchema),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).passthrough();

// ── Organization Schemas ─────────────────────────────────────────

export const organizationResponseSchema = z.object({
  _id: objectIdSchema,
  clerkId: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  imageUrl: z.string().optional(),
  // subscription is REQUIRED — handler must provide defaults
  subscription: z.object({
    plan: z.enum(['unpaid', 'professional', 'enterprise']),
    status: z.enum(['active', 'canceled', 'past_due']),
    seats: z.number().optional(),
  }),
  features: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).passthrough();

export const orgMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(['admin', 'member']),
  joinedAt: dateSchema,
});

// ── Billing Schemas ──────────────────────────────────────────────

export const billingUsageResponseSchema = z.object({
  plan: z.enum(['unpaid', 'professional', 'enterprise']),
  currentPeriod: z.string(),
  trialEndsAt: z.string().nullable().optional(),
  trialExpired: z.boolean().optional(),
  agents: z.object({ used: z.number(), limit: z.number() }),
  messages: z.object({ used: z.number(), limit: z.number() }),
  storage: z.object({ used: z.number(), limit: z.number(), unit: z.string() }),
  limits: z.record(z.any()),
});

// ── Template Schemas ─────────────────────────────────────────────

export const templateResponseSchema = z.object({
  _id: objectIdSchema,
  name: z.string(),
  description: z.string(),
  category: z.enum(['sales', 'support', 'marketing', 'operations', 'finance']),
  icon: z.string(),
  channels: z.array(z.string()),
  features: z.array(z.string()),
  integrations: z.array(z.string()),
  pricing: z.object({
    setup: z.number(),
    monthly: z.number(),
    perOutcome: z.number().optional(),
    outcomeLabel: z.string().optional(),
  }),
  popularity: z.number(),
  isPublic: z.boolean(),
  createdBy: z.string().optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const listTemplatesResponseSchema = z.object({
  templates: z.array(templateResponseSchema),
});

// ── Provider Schemas ─────────────────────────────────────────────

export const providerResponseSchema = z.object({
  _id: objectIdSchema,
  organizationId: z.string().optional(),
  provider: z.string(),
  label: z.string(),
  status: z.enum(['active', 'invalid', 'unchecked']),
  apiKeyLastFour: z.string(),
  baseUrl: z.string().optional(),
  availableModels: z.array(z.string()).optional(),
  createdAt: dateSchema,
  updatedAt: dateSchema.optional(),
});

// ── Log Schemas ──────────────────────────────────────────────────

export const logResponseSchema = z.object({
  _id: objectIdSchema,
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  level: z.enum(['info', 'warning', 'error', 'debug']),
  message: z.string(),
  metadata: z.record(z.any()).optional(),
  createdAt: dateSchema,
});

export const listLogsResponseSchema = z.object({
  logs: z.array(logResponseSchema),
  total: z.number(),
});

// ── Webhook Schemas ──────────────────────────────────────────────

export const webhookResponseSchema = z.object({
  _id: objectIdSchema,
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  status: z.enum(['active', 'inactive']),
  metrics: z.object({
    totalCalls: z.number(),
    successfulCalls: z.number(),
    failedCalls: z.number(),
    lastCalledAt: dateSchema.optional(),
  }),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

// ── Integration Schemas ──────────────────────────────────────────

export const integrationResponseSchema = z.object({
  _id: objectIdSchema,
  type: z.enum(['slack', 'hubspot', 'salesforce', 'zapier', 'webhook']),
  name: z.string(),
  status: z.enum(['connected', 'disconnected', 'error']),
  config: z.record(z.any()),
  metadata: z.record(z.any()),
  createdAt: dateSchema,
  updatedAt: dateSchema,
}).passthrough();

// ── Support Schemas ──────────────────────────────────────────────

export const supportTicketResponseSchema = z.object({
  _id: objectIdSchema,
  subject: z.string(),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  messages: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    content: z.string(),
    isAgent: z.boolean(),
    createdAt: dateSchema,
  })),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

// ── Activity Schemas ─────────────────────────────────────────────

export const activityEventSchema = z.object({
  _id: objectIdSchema,
  type: z.string(),
  title: z.string(),
  description: z.string(),
  agentId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: dateSchema,
});

export const listActivityResponseSchema = z.object({
  events: z.array(activityEventSchema),
  total: z.number(),
});

// ── Health Schemas ───────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: dateSchema,
});

// ── Gateway Schemas (common patterns) ────────────────────────────

export const gatewayHealthSchema = z.object({
  ok: z.boolean(),
  uptime: z.number().optional(),
  version: z.string().optional(),
});

export const gatewaySessionSchema = z.object({
  key: z.string(),
  agentId: z.string().optional(),
  channel: z.string().optional(),
  messageCount: z.number().optional(),
  lastMessageAt: z.string().optional(),
  /** Human-readable label (from sessions_spawn or manual patch) */
  label: z.string().optional(),
  /** Display name (group/channel name or label fallback) */
  displayName: z.string().optional(),
  /** Derived from first user message when includeDerivedTitles */
  derivedTitle: z.string().optional(),
  /** Last activity timestamp (ms) */
  updatedAt: z.number().nullable().optional(),
  /** Session kind: direct | group | global | unknown */
  kind: z.string().optional(),
}).passthrough();

export const gatewayMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().optional(),
});

