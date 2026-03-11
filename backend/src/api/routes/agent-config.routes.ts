import { FastifyInstance } from 'fastify';
import { getDatabase } from '../../config/database.js';
import { ObjectId } from 'mongodb';
import { validateObjectId } from '../../validation/schemas.js';
import { deploymentService } from '../../services/deployment.service.js';
import { workspaceService } from '../../services/workspace.service.js';
import { z } from 'zod';
import {
  errorResponseSchema,
  notFoundErrorSchema,
  successResponseSchema,
} from '../../validation/response-schemas.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

// ── Agent Configuration Schemas ───────────────────────────────────

const agentConfigurationSchema = z.object({
  // Core
  model: z.string().describe('Primary model ID'),
  fallbackModels: z.array(z.string()).describe('Fallback model IDs'),
  systemPrompt: z.string().describe('System prompt / AGENTS.md override'),
  temperature: z.number().describe('Sampling temperature'),
  maxTokens: z.number().describe('Max output tokens'),

  // Tools
  toolProfile: z.string().describe('Tool profile preset'),
  toolAllow: z.array(z.string()).describe('Allowed tools'),
  toolDeny: z.array(z.string()).describe('Denied tools'),
  skills: z.array(z.string()).describe('Enabled skill IDs'),

  // Session
  sessionScope: z.string().describe('Session scope strategy'),
  sessionDmScope: z.string().describe('DM session scope'),
  sessionResetMode: z.string().describe('Session reset mode'),
  sessionResetTriggers: z.array(z.string()).describe('Commands that reset session'),
  sessionAtHour: z.number().describe('Hour for daily reset'),
  sessionIdleMinutes: z.number().describe('Minutes before idle reset'),
  sessionMainKey: z.string().describe('Main session key'),
  sessionIdentityLinks: z.record(z.any()).describe('Identity link mappings'),
  sessionResetByType: z.any().nullable().describe('Per-type reset config'),
  maxConcurrent: z.number().describe('Max concurrent sessions'),

  // Memory
  memoryProvider: z.string().describe('Memory search provider'),

  // Persona
  soulPrompt: z.string().describe('SOUL.md persona prompt'),
  identityName: z.string().describe('Agent display name'),

  // Streaming & Response
  blockStreaming: z.string().describe('Block streaming mode'),
  blockStreamingBreak: z.string().describe('Block break strategy'),
  humanDelay: z.string().describe('Human typing delay mode'),
  humanDelayMin: z.number().describe('Min delay ms'),
  humanDelayMax: z.number().describe('Max delay ms'),
  telegramStreamMode: z.string().describe('Telegram stream mode'),

  // Thinking / Reasoning
  thinkingLevel: z.string().describe('Thinking/reasoning level'),
  reasoningVisibility: z.string().describe('Reasoning visibility'),

  // Streaming Advanced
  blockStreamingChunkMin: z.number().describe('Min chunk size for block streaming'),
  blockStreamingChunkMax: z.number().describe('Max chunk size for block streaming'),
  blockStreamingCoalesceIdleMs: z.number().describe('Coalesce idle threshold ms'),
  telegramDraftChunkMin: z.number().describe('Min Telegram draft chunk'),
  telegramDraftChunkMax: z.number().describe('Max Telegram draft chunk'),

  // Heartbeat
  heartbeatEnabled: z.boolean().describe('Heartbeat enabled'),
  heartbeatInterval: z.string().describe('Heartbeat interval'),
  heartbeatTarget: z.string().describe('Heartbeat target channel'),
  heartbeatModel: z.string().describe('Heartbeat model override'),
  heartbeatPrompt: z.string().describe('Heartbeat prompt override'),
  heartbeatTo: z.string().describe('Heartbeat recipient'),
  heartbeatAccountId: z.string().describe('Heartbeat account ID'),
  heartbeatIncludeReasoning: z.boolean().describe('Include reasoning in heartbeat'),
  heartbeatActiveHoursStart: z.string().describe('Active hours start (HH:MM)'),
  heartbeatActiveHoursEnd: z.string().describe('Active hours end (HH:MM)'),
  heartbeatActiveHoursTimezone: z.string().describe('Active hours timezone'),
  heartbeatAckMaxChars: z.number().describe('Max heartbeat ack chars'),

  // Tools Advanced
  toolAlsoAllow: z.array(z.string()).describe('Additional allowed tools'),
  toolMediaMaxSize: z.number().describe('Max media size bytes'),
  toolSubagentAllow: z.array(z.string()).describe('Sub-agent allowed tools'),
  toolSubagentDeny: z.array(z.string()).describe('Sub-agent denied tools'),

  // Sandbox
  sandboxMode: z.string().describe('Sandbox mode'),
  sandboxScope: z.string().describe('Sandbox scope'),
  sandboxWorkspaceAccess: z.string().describe('Sandbox workspace access'),
  sandboxNetwork: z.string().describe('Sandbox network mode'),
  sandboxBrowser: z.boolean().describe('Sandbox browser enabled'),
  sandboxDockerImage: z.string().describe('Custom Docker image'),
  sandboxSetupCommand: z.string().describe('Sandbox setup command'),
  sandboxMemory: z.string().describe('Sandbox memory limit'),
  sandboxCpus: z.number().describe('Sandbox CPU limit'),
  sandboxPidsLimit: z.number().describe('Sandbox PID limit'),
  sandboxDns: z.array(z.string()).describe('Sandbox DNS servers'),
  sandboxExtraHosts: z.array(z.string()).describe('Sandbox extra /etc/hosts entries'),
  sandboxPruneIdleHours: z.number().describe('Prune after idle hours'),
  sandboxMaxAgeDays: z.number().describe('Max sandbox age days'),
  sandboxBrowserHostControl: z.boolean().describe('Browser host control enabled'),

  // Voice Call
  voiceCallEnabled: z.boolean().describe('Voice call enabled'),
  voiceCallProvider: z.string().describe('Voice call provider'),
  voiceCallTwilioSid: z.string().describe('Twilio account SID'),
  voiceCallTwilioToken: z.string().describe('Twilio auth token'),
  voiceCallFrom: z.string().describe('Voice call from number'),
  voiceCallInboundPolicy: z.string().describe('Inbound call policy'),
  voiceCallTtsProvider: z.string().describe('TTS provider for calls'),
  voiceCallTtsVoice: z.string().describe('TTS voice ID'),

  // Hooks / Webhooks
  hooksEnabled: z.boolean().describe('Hooks enabled'),
  hooksToken: z.string().describe('Hooks shared secret token'),
  hooksPresets: z.array(z.string()).describe('Hook presets'),
  hooksMappings: z.array(z.any()).describe('Hook mapping rules'),
  gmailAccount: z.string().describe('Gmail account for hooks'),
  gmailIncludeBody: z.boolean().describe('Include Gmail body'),
  gmailMaxBytes: z.number().describe('Max Gmail body bytes'),

  // OpenAI API
  apiEnabled: z.boolean().describe('Chat Completions API enabled'),
  responsesApiEnabled: z.boolean().describe('Responses API enabled'),

  // Lobster Workflows
  lobsterEnabled: z.boolean().describe('Lobster workflows enabled'),


  // Channel Advanced
  channelAdvanced: z.record(z.any()).describe('Per-channel advanced overrides'),

  // Memory Advanced
  memorySearchExtraPaths: z.array(z.string()).describe('Extra memory search paths'),
  memorySearchBatchEnabled: z.boolean().describe('Batch memory search enabled'),

  // Skills Advanced
  skillsAllowBundled: z.boolean().describe('Allow bundled skills'),
  skillsExtraDirs: z.array(z.string()).describe('Extra skill directories'),

  // Logging
  loggingLevel: z.string().describe('Logging level'),

  // Browser
  browserEnabled: z.boolean().describe('Browser tool enabled'),
  browserProfilesEnabled: z.boolean().describe('Browser profiles enabled'),

  // TTS
  ttsEnabled: z.boolean().describe('Text-to-speech enabled'),
  ttsProvider: z.string().describe('TTS provider'),
  ttsVoice: z.string().describe('TTS voice ID'),

  // Image Model
  imageModel: z.string().describe('Image generation model'),
});

const agentConfigurationResponseSchema = z.object({
  configuration: agentConfigurationSchema,
});

const updateAgentConfigurationBodySchema = z.object({
  model: z.string().optional(),
  fallbackModels: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  toolProfile: z.string().optional(),
  toolAllow: z.array(z.string()).optional(),
  toolDeny: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  sessionScope: z.string().optional(),
  sessionDmScope: z.string().optional(),
  sessionResetMode: z.string().optional(),
  sessionResetTriggers: z.array(z.string()).optional(),
  sessionAtHour: z.number().optional(),
  sessionIdleMinutes: z.number().optional(),
  sessionMainKey: z.string().optional(),
  sessionIdentityLinks: z.record(z.any()).optional(),
  sessionResetByType: z.any().nullable().optional(),
  maxConcurrent: z.number().optional(),
  memoryProvider: z.string().optional(),
  soulPrompt: z.string().optional(),
  identityName: z.string().optional(),
  blockStreaming: z.string().optional(),
  blockStreamingBreak: z.string().optional(),
  humanDelay: z.string().optional(),
  humanDelayMin: z.number().optional(),
  humanDelayMax: z.number().optional(),
  telegramStreamMode: z.string().optional(),
  thinkingLevel: z.string().optional(),
  reasoningVisibility: z.string().optional(),
  blockStreamingChunkMin: z.number().optional(),
  blockStreamingChunkMax: z.number().optional(),
  blockStreamingCoalesceIdleMs: z.number().optional(),
  telegramDraftChunkMin: z.number().optional(),
  telegramDraftChunkMax: z.number().optional(),
  heartbeatEnabled: z.boolean().optional(),
  heartbeatInterval: z.string().optional(),
  heartbeatTarget: z.string().optional(),
  heartbeatModel: z.string().optional(),
  heartbeatPrompt: z.string().optional(),
  heartbeatTo: z.string().optional(),
  heartbeatAccountId: z.string().optional(),
  heartbeatIncludeReasoning: z.boolean().optional(),
  heartbeatActiveHoursStart: z.string().optional(),
  heartbeatActiveHoursEnd: z.string().optional(),
  heartbeatActiveHoursTimezone: z.string().optional(),
  heartbeatAckMaxChars: z.number().optional(),
  toolAlsoAllow: z.array(z.string()).optional(),
  toolMediaMaxSize: z.number().optional(),
  toolSubagentAllow: z.array(z.string()).optional(),
  toolSubagentDeny: z.array(z.string()).optional(),
  sandboxMode: z.string().optional(),
  sandboxScope: z.string().optional(),
  sandboxWorkspaceAccess: z.string().optional(),
  sandboxNetwork: z.string().optional(),
  sandboxBrowser: z.boolean().optional(),
  sandboxDockerImage: z.string().optional(),
  sandboxSetupCommand: z.string().optional(),
  sandboxMemory: z.string().optional(),
  sandboxCpus: z.number().optional(),
  sandboxPidsLimit: z.number().optional(),
  sandboxDns: z.array(z.string()).optional(),
  sandboxExtraHosts: z.array(z.string()).optional(),
  sandboxPruneIdleHours: z.number().optional(),
  sandboxMaxAgeDays: z.number().optional(),
  sandboxBrowserHostControl: z.boolean().optional(),
  voiceCallEnabled: z.boolean().optional(),
  voiceCallProvider: z.string().optional(),
  voiceCallTwilioSid: z.string().optional(),
  voiceCallTwilioToken: z.string().optional(),
  voiceCallFrom: z.string().optional(),
  voiceCallInboundPolicy: z.string().optional(),
  voiceCallTtsProvider: z.string().optional(),
  voiceCallTtsVoice: z.string().optional(),
  hooksEnabled: z.boolean().optional(),
  hooksToken: z.string().optional(),
  hooksPresets: z.array(z.string()).optional(),
  hooksMappings: z.array(z.any()).optional(),
  gmailAccount: z.string().optional(),
  gmailIncludeBody: z.boolean().optional(),
  gmailMaxBytes: z.number().optional(),
  apiEnabled: z.boolean().optional(),
  responsesApiEnabled: z.boolean().optional(),
  lobsterEnabled: z.boolean().optional(),
  channelAdvanced: z.record(z.any()).optional(),
  memorySearchExtraPaths: z.array(z.string()).optional(),
  memorySearchBatchEnabled: z.boolean().optional(),
  skillsAllowBundled: z.boolean().optional(),
  skillsExtraDirs: z.array(z.string()).optional(),
  loggingLevel: z.string().optional(),
  browserEnabled: z.boolean().optional(),
  browserProfilesEnabled: z.boolean().optional(),
  ttsEnabled: z.boolean().optional(),
  ttsProvider: z.string().optional(),
  ttsVoice: z.string().optional(),
  imageModel: z.string().optional(),
}).describe('Partial agent configuration update — only provided fields are changed');

export async function agentConfigRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const agentsCollection = db.collection('agents');

  // ── Trial guard: block mutations when trial has expired ──────────
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET') return;
    if (request.trialExpired) {
      return reply.code(403).send({
        error: 'Payment required',
        message: 'Upgrade to Professional to continue.',
      });
    }
  });

  // Helper: build ownership filter
  function ownershipFilter(request: any, agentId: string) {
    const filter: any = { _id: new ObjectId(agentId) };
    if (request.organizationId) {
      filter.organizationId = request.organizationId;
    } else {
      filter.userId = request.userId;
    }
    return filter;
  }

  // GET /api/agents/:id/configuration - Get agent configuration
  fastify.get<{ Params: { id: string } }>('/:id/configuration', {
    schema: {
      tags: ['Agent Configuration'],
      summary: 'Get agent configuration',
      description: 'Returns the full agent configuration object with 80+ fields covering model, tools, session, memory, streaming, heartbeat, sandbox, voice call, hooks, and more.',
      params: z.object({ id: z.string().describe('Agent ID') }),
      response: {
        200: agentConfigurationResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
  }, async (request, reply) => {
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const agent = await agentsCollection.findOne(ownershipFilter(request, agentId));

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return {
      configuration: {
        // Core
        model: agent.config?.model || null,
        fallbackModels: agent.config?.fallbackModels || [],
        systemPrompt: agent.config?.systemPrompt || '',
        temperature: agent.config?.temperature || 0.7,
        maxTokens: agent.config?.maxTokens || 4096,

        // Tools
        toolProfile: agent.config?.toolProfile || 'messaging',
        toolAllow: agent.config?.toolAllow || [],
        toolDeny: agent.config?.toolDeny || [],
        skills: agent.config?.skills || [],

        // Session
        sessionScope: agent.config?.sessionScope || 'per-sender',
        sessionDmScope: agent.config?.sessionDmScope || 'per-channel-peer',
        sessionResetMode: agent.config?.sessionResetMode || 'daily',
        sessionResetTriggers: agent.config?.sessionResetTriggers || ['/new', '/reset'],
        sessionAtHour: agent.config?.sessionAtHour ?? 4,
        sessionIdleMinutes: agent.config?.sessionIdleMinutes ?? 120,
        sessionMainKey: agent.config?.sessionMainKey || 'main',
        sessionIdentityLinks: agent.config?.sessionIdentityLinks || {},
        sessionResetByType: agent.config?.sessionResetByType || null,
        maxConcurrent: agent.config?.maxConcurrent ?? 3,

        // Memory
        memoryProvider: agent.config?.memoryProvider || 'local',

        // Persona
        soulPrompt: agent.config?.soulPrompt || '',
        identityName: agent.config?.identityName || agent.name || '',

        // Streaming & Response
        blockStreaming: agent.config?.blockStreaming || 'off',
        blockStreamingBreak: agent.config?.blockStreamingBreak || 'text_end',
        humanDelay: agent.config?.humanDelay || 'off',
        humanDelayMin: agent.config?.humanDelayMin ?? 800,
        humanDelayMax: agent.config?.humanDelayMax ?? 2500,
        telegramStreamMode: agent.config?.telegramStreamMode || 'partial',

        // Thinking / Reasoning
        thinkingLevel: agent.config?.thinkingLevel || 'low',
        reasoningVisibility: agent.config?.reasoningVisibility || 'off',

        // Streaming Advanced
        blockStreamingChunkMin: agent.config?.blockStreamingChunkMin ?? 0,
        blockStreamingChunkMax: agent.config?.blockStreamingChunkMax ?? 0,
        blockStreamingCoalesceIdleMs: agent.config?.blockStreamingCoalesceIdleMs ?? 0,
        telegramDraftChunkMin: agent.config?.telegramDraftChunkMin ?? 0,
        telegramDraftChunkMax: agent.config?.telegramDraftChunkMax ?? 0,

        // Heartbeat
        heartbeatEnabled: agent.config?.heartbeatEnabled ?? false,
        heartbeatInterval: agent.config?.heartbeatInterval || '30m',
        heartbeatTarget: agent.config?.heartbeatTarget || 'last',
        heartbeatModel: agent.config?.heartbeatModel || '',
        heartbeatPrompt: agent.config?.heartbeatPrompt || '',
        heartbeatTo: agent.config?.heartbeatTo || '',
        heartbeatAccountId: agent.config?.heartbeatAccountId || '',
        heartbeatIncludeReasoning: agent.config?.heartbeatIncludeReasoning ?? false,
        heartbeatActiveHoursStart: agent.config?.heartbeatActiveHoursStart || '',
        heartbeatActiveHoursEnd: agent.config?.heartbeatActiveHoursEnd || '',
        heartbeatActiveHoursTimezone: agent.config?.heartbeatActiveHoursTimezone || '',
        heartbeatAckMaxChars: agent.config?.heartbeatAckMaxChars ?? 0,

        // Tools Advanced
        toolAlsoAllow: agent.config?.toolAlsoAllow || [],
        toolMediaMaxSize: agent.config?.toolMediaMaxSize ?? 0,
        toolSubagentAllow: agent.config?.toolSubagentAllow || [],
        toolSubagentDeny: agent.config?.toolSubagentDeny || [],

        // Sandbox
        sandboxMode: agent.config?.sandboxMode || 'off',
        sandboxScope: agent.config?.sandboxScope || 'session',
        sandboxWorkspaceAccess: agent.config?.sandboxWorkspaceAccess || 'none',
        sandboxNetwork: agent.config?.sandboxNetwork || 'none',
        sandboxBrowser: agent.config?.sandboxBrowser ?? false,
        sandboxDockerImage: agent.config?.sandboxDockerImage || '',
        sandboxSetupCommand: agent.config?.sandboxSetupCommand || '',
        sandboxMemory: agent.config?.sandboxMemory || '',
        sandboxCpus: agent.config?.sandboxCpus ?? 0,
        sandboxPidsLimit: agent.config?.sandboxPidsLimit ?? 0,
        sandboxDns: agent.config?.sandboxDns || [],
        sandboxExtraHosts: agent.config?.sandboxExtraHosts || [],
        sandboxPruneIdleHours: agent.config?.sandboxPruneIdleHours ?? 0,
        sandboxMaxAgeDays: agent.config?.sandboxMaxAgeDays ?? 0,
        sandboxBrowserHostControl: agent.config?.sandboxBrowserHostControl ?? false,

        // Voice Call
        voiceCallEnabled: agent.config?.voiceCallEnabled ?? false,
        voiceCallProvider: agent.config?.voiceCallProvider || 'disabled',
        voiceCallTwilioSid: agent.config?.voiceCallTwilioSid || '',
        voiceCallTwilioToken: agent.config?.voiceCallTwilioToken || '',
        voiceCallFrom: agent.config?.voiceCallFrom || '',
        voiceCallInboundPolicy: agent.config?.voiceCallInboundPolicy || 'notify',
        voiceCallTtsProvider: agent.config?.voiceCallTtsProvider || 'openai',
        voiceCallTtsVoice: agent.config?.voiceCallTtsVoice || '',

        // Hooks / Webhooks
        hooksEnabled: agent.config?.hooksEnabled ?? false,
        hooksToken: agent.config?.hooksToken || '',
        hooksPresets: agent.config?.hooksPresets || [],
        hooksMappings: agent.config?.hooksMappings || [],
        gmailAccount: agent.config?.gmailAccount || '',
        gmailIncludeBody: agent.config?.gmailIncludeBody ?? true,
        gmailMaxBytes: agent.config?.gmailMaxBytes ?? 0,

        // OpenAI API
        apiEnabled: agent.config?.apiEnabled ?? false,
        responsesApiEnabled: agent.config?.responsesApiEnabled ?? false,

        // Lobster Workflows
        lobsterEnabled: agent.config?.lobsterEnabled ?? false,


        // Channel Advanced Settings (per-channel overrides)
        channelAdvanced: agent.config?.channelAdvanced || {},

        // Memory Advanced
        memorySearchExtraPaths: agent.config?.memorySearchExtraPaths || [],
        memorySearchBatchEnabled: agent.config?.memorySearchBatchEnabled ?? false,

        // Skills Advanced
        skillsAllowBundled: agent.config?.skillsAllowBundled ?? true,
        skillsExtraDirs: agent.config?.skillsExtraDirs || [],

        // Logging
        loggingLevel: agent.config?.loggingLevel || 'info',

        // Browser
        browserEnabled: agent.config?.browserEnabled ?? false,
        browserProfilesEnabled: agent.config?.browserProfilesEnabled ?? false,

        // TTS
        ttsEnabled: agent.config?.ttsEnabled ?? false,
        ttsProvider: agent.config?.ttsProvider || 'openai',
        ttsVoice: agent.config?.ttsVoice || '',

        // Image Model
        imageModel: agent.config?.imageModel || '',
      },
    };
  });

  // PATCH /api/agents/:id/configuration - Update agent configuration
  fastify.patch<{ Params: { id: string }; Body: any }>('/:id/configuration', {
    schema: {
      tags: ['Agent Configuration'],
      summary: 'Update agent configuration',
      description: 'Partially updates the agent configuration. Only provided fields are changed. Automatically syncs relevant changes to the running OpenClaw container (model, tools, session, streaming, heartbeat, sandbox, hooks, etc.).',
      params: z.object({ id: z.string().describe('Agent ID') }),
      body: updateAgentConfigurationBodySchema,
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        404: notFoundErrorSchema,
      },
    },
    preHandler: requirePermission('agents.configure'),
  }, async (request, reply) => {
    const agentId = request.params.id;

    if (!validateObjectId(agentId)) {
      return reply.code(400).send({ error: 'Invalid agent ID format' });
    }

    const body = request.body as any;
    const updates: any = { updatedAt: new Date() };

    // Core fields
    if (body.model) updates['config.model'] = body.model;
    if (body.fallbackModels) updates['config.fallbackModels'] = body.fallbackModels;
    if (body.systemPrompt !== undefined) updates['config.systemPrompt'] = body.systemPrompt;
    if (body.temperature !== undefined) updates['config.temperature'] = body.temperature;
    if (body.maxTokens !== undefined) updates['config.maxTokens'] = body.maxTokens;

    // Tools
    if (body.toolProfile) updates['config.toolProfile'] = body.toolProfile;
    if (body.toolAllow) updates['config.toolAllow'] = body.toolAllow;
    if (body.toolDeny) updates['config.toolDeny'] = body.toolDeny;
    if (body.skills) updates['config.skills'] = body.skills;

    // Session
    if (body.sessionScope) updates['config.sessionScope'] = body.sessionScope;
    if (body.sessionDmScope) updates['config.sessionDmScope'] = body.sessionDmScope;
    if (body.sessionResetMode) updates['config.sessionResetMode'] = body.sessionResetMode;
    if (body.sessionResetTriggers) updates['config.sessionResetTriggers'] = body.sessionResetTriggers;
    if (body.sessionAtHour !== undefined) updates['config.sessionAtHour'] = body.sessionAtHour;
    if (body.sessionIdleMinutes !== undefined) updates['config.sessionIdleMinutes'] = body.sessionIdleMinutes;
    if (body.sessionMainKey !== undefined) updates['config.sessionMainKey'] = body.sessionMainKey;
    if (body.sessionIdentityLinks !== undefined) updates['config.sessionIdentityLinks'] = body.sessionIdentityLinks;
    if (body.sessionResetByType !== undefined) updates['config.sessionResetByType'] = body.sessionResetByType;

    // Memory
    if (body.memoryProvider) updates['config.memoryProvider'] = body.memoryProvider;

    // Persona
    if (body.soulPrompt !== undefined) updates['config.soulPrompt'] = body.soulPrompt;
    if (body.identityName !== undefined) updates['config.identityName'] = body.identityName;

    // Session advanced
    if (body.maxConcurrent !== undefined) updates['config.maxConcurrent'] = body.maxConcurrent;

    // Streaming & Response
    if (body.blockStreaming) updates['config.blockStreaming'] = body.blockStreaming;
    if (body.blockStreamingBreak) updates['config.blockStreamingBreak'] = body.blockStreamingBreak;
    if (body.humanDelay) updates['config.humanDelay'] = body.humanDelay;
    if (body.humanDelayMin !== undefined) updates['config.humanDelayMin'] = body.humanDelayMin;
    if (body.humanDelayMax !== undefined) updates['config.humanDelayMax'] = body.humanDelayMax;
    if (body.telegramStreamMode) updates['config.telegramStreamMode'] = body.telegramStreamMode;

    // Thinking / Reasoning
    if (body.thinkingLevel) updates['config.thinkingLevel'] = body.thinkingLevel;
    if (body.reasoningVisibility) updates['config.reasoningVisibility'] = body.reasoningVisibility;

    // Streaming Advanced
    if (body.blockStreamingChunkMin !== undefined) updates['config.blockStreamingChunkMin'] = body.blockStreamingChunkMin;
    if (body.blockStreamingChunkMax !== undefined) updates['config.blockStreamingChunkMax'] = body.blockStreamingChunkMax;
    if (body.blockStreamingCoalesceIdleMs !== undefined) updates['config.blockStreamingCoalesceIdleMs'] = body.blockStreamingCoalesceIdleMs;
    if (body.telegramDraftChunkMin !== undefined) updates['config.telegramDraftChunkMin'] = body.telegramDraftChunkMin;
    if (body.telegramDraftChunkMax !== undefined) updates['config.telegramDraftChunkMax'] = body.telegramDraftChunkMax;

    // Heartbeat
    if (body.heartbeatEnabled !== undefined) updates['config.heartbeatEnabled'] = body.heartbeatEnabled;
    if (body.heartbeatInterval) updates['config.heartbeatInterval'] = body.heartbeatInterval;
    if (body.heartbeatTarget) updates['config.heartbeatTarget'] = body.heartbeatTarget;
    if (body.heartbeatModel !== undefined) updates['config.heartbeatModel'] = body.heartbeatModel;
    if (body.heartbeatPrompt !== undefined) updates['config.heartbeatPrompt'] = body.heartbeatPrompt;
    if (body.heartbeatTo !== undefined) updates['config.heartbeatTo'] = body.heartbeatTo;
    if (body.heartbeatAccountId !== undefined) updates['config.heartbeatAccountId'] = body.heartbeatAccountId;
    if (body.heartbeatIncludeReasoning !== undefined) updates['config.heartbeatIncludeReasoning'] = body.heartbeatIncludeReasoning;
    if (body.heartbeatActiveHoursStart !== undefined) updates['config.heartbeatActiveHoursStart'] = body.heartbeatActiveHoursStart;
    if (body.heartbeatActiveHoursEnd !== undefined) updates['config.heartbeatActiveHoursEnd'] = body.heartbeatActiveHoursEnd;
    if (body.heartbeatActiveHoursTimezone !== undefined) updates['config.heartbeatActiveHoursTimezone'] = body.heartbeatActiveHoursTimezone;
    if (body.heartbeatAckMaxChars !== undefined) updates['config.heartbeatAckMaxChars'] = body.heartbeatAckMaxChars;

    // Tools Advanced
    if (body.toolAlsoAllow) updates['config.toolAlsoAllow'] = body.toolAlsoAllow;
    if (body.toolMediaMaxSize !== undefined) updates['config.toolMediaMaxSize'] = body.toolMediaMaxSize;
    if (body.toolSubagentAllow) updates['config.toolSubagentAllow'] = body.toolSubagentAllow;
    if (body.toolSubagentDeny) updates['config.toolSubagentDeny'] = body.toolSubagentDeny;

    // Sandbox
    if (body.sandboxMode) updates['config.sandboxMode'] = body.sandboxMode;
    if (body.sandboxScope) updates['config.sandboxScope'] = body.sandboxScope;
    if (body.sandboxWorkspaceAccess) updates['config.sandboxWorkspaceAccess'] = body.sandboxWorkspaceAccess;
    if (body.sandboxNetwork) updates['config.sandboxNetwork'] = body.sandboxNetwork;
    if (body.sandboxBrowser !== undefined) updates['config.sandboxBrowser'] = body.sandboxBrowser;
    if (body.sandboxDockerImage !== undefined) updates['config.sandboxDockerImage'] = body.sandboxDockerImage;
    if (body.sandboxSetupCommand !== undefined) updates['config.sandboxSetupCommand'] = body.sandboxSetupCommand;
    if (body.sandboxMemory !== undefined) updates['config.sandboxMemory'] = body.sandboxMemory;
    if (body.sandboxCpus !== undefined) updates['config.sandboxCpus'] = body.sandboxCpus;
    if (body.sandboxPidsLimit !== undefined) updates['config.sandboxPidsLimit'] = body.sandboxPidsLimit;
    if (body.sandboxDns) updates['config.sandboxDns'] = body.sandboxDns;
    if (body.sandboxExtraHosts) updates['config.sandboxExtraHosts'] = body.sandboxExtraHosts;
    if (body.sandboxPruneIdleHours !== undefined) updates['config.sandboxPruneIdleHours'] = body.sandboxPruneIdleHours;
    if (body.sandboxMaxAgeDays !== undefined) updates['config.sandboxMaxAgeDays'] = body.sandboxMaxAgeDays;
    if (body.sandboxBrowserHostControl !== undefined) updates['config.sandboxBrowserHostControl'] = body.sandboxBrowserHostControl;

    // Voice Call
    if (body.voiceCallEnabled !== undefined) updates['config.voiceCallEnabled'] = body.voiceCallEnabled;
    if (body.voiceCallProvider) updates['config.voiceCallProvider'] = body.voiceCallProvider;
    if (body.voiceCallTwilioSid !== undefined) updates['config.voiceCallTwilioSid'] = body.voiceCallTwilioSid;
    if (body.voiceCallTwilioToken !== undefined) updates['config.voiceCallTwilioToken'] = body.voiceCallTwilioToken;
    if (body.voiceCallFrom !== undefined) updates['config.voiceCallFrom'] = body.voiceCallFrom;
    if (body.voiceCallInboundPolicy) updates['config.voiceCallInboundPolicy'] = body.voiceCallInboundPolicy;
    if (body.voiceCallTtsProvider) updates['config.voiceCallTtsProvider'] = body.voiceCallTtsProvider;
    if (body.voiceCallTtsVoice !== undefined) updates['config.voiceCallTtsVoice'] = body.voiceCallTtsVoice;

    // Hooks / Webhooks
    if (body.hooksEnabled !== undefined) updates['config.hooksEnabled'] = body.hooksEnabled;
    if (body.hooksToken !== undefined) updates['config.hooksToken'] = body.hooksToken;
    if (body.hooksPresets) updates['config.hooksPresets'] = body.hooksPresets;
    if (body.hooksMappings !== undefined) updates['config.hooksMappings'] = body.hooksMappings;
    if (body.gmailAccount !== undefined) updates['config.gmailAccount'] = body.gmailAccount;
    if (body.gmailIncludeBody !== undefined) updates['config.gmailIncludeBody'] = body.gmailIncludeBody;
    if (body.gmailMaxBytes !== undefined) updates['config.gmailMaxBytes'] = body.gmailMaxBytes;

    // OpenAI API
    if (body.apiEnabled !== undefined) updates['config.apiEnabled'] = body.apiEnabled;
    if (body.responsesApiEnabled !== undefined) updates['config.responsesApiEnabled'] = body.responsesApiEnabled;

    // Lobster Workflows
    if (body.lobsterEnabled !== undefined) updates['config.lobsterEnabled'] = body.lobsterEnabled;


    // Channel Advanced Settings
    if (body.channelAdvanced !== undefined) updates['config.channelAdvanced'] = body.channelAdvanced;

    // Memory Advanced
    if (body.memorySearchExtraPaths) updates['config.memorySearchExtraPaths'] = body.memorySearchExtraPaths;
    if (body.memorySearchBatchEnabled !== undefined) updates['config.memorySearchBatchEnabled'] = body.memorySearchBatchEnabled;

    // Skills Advanced
    if (body.skillsAllowBundled !== undefined) updates['config.skillsAllowBundled'] = body.skillsAllowBundled;
    if (body.skillsExtraDirs) updates['config.skillsExtraDirs'] = body.skillsExtraDirs;

    // Logging
    if (body.loggingLevel) updates['config.loggingLevel'] = body.loggingLevel;

    // Browser
    if (body.browserEnabled !== undefined) updates['config.browserEnabled'] = body.browserEnabled;
    if (body.browserProfilesEnabled !== undefined) updates['config.browserProfilesEnabled'] = body.browserProfilesEnabled;

    // TTS
    if (body.ttsEnabled !== undefined) updates['config.ttsEnabled'] = body.ttsEnabled;
    if (body.ttsProvider) updates['config.ttsProvider'] = body.ttsProvider;
    if (body.ttsVoice !== undefined) updates['config.ttsVoice'] = body.ttsVoice;

    // Image Model
    if (body.imageModel !== undefined) updates['config.imageModel'] = body.imageModel;

    const result = await agentsCollection.updateOne(
      ownershipFilter(request, agentId),
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Sync relevant config changes to the running OpenClaw container
    try {
      const openclawUpdates: any = {};

      if (body.model || body.fallbackModels) {
        openclawUpdates.agents = {
          defaults: {
            model: {
              primary: body.model,
              fallbacks: body.fallbackModels?.length > 0 ? body.fallbackModels : undefined,
            },
          },
        };
      }

      if (body.toolProfile || body.toolAllow || body.toolDeny) {
        openclawUpdates.tools = {
          profile: body.toolProfile,
          allow: body.toolAllow,
          deny: body.toolDeny,
        };
      }

      if (body.sessionScope || body.sessionResetMode || body.sessionResetTriggers) {
        openclawUpdates.session = {
          scope: body.sessionScope,
          reset: body.sessionResetMode ? { mode: body.sessionResetMode } : undefined,
          resetTriggers: body.sessionResetTriggers,
        };
      }

      if (body.memoryProvider) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            memorySearch: {
              provider: body.memoryProvider === 'none' ? undefined : body.memoryProvider,
            },
          },
        };
      }

      // Streaming config sync
      if (body.blockStreaming || body.blockStreamingBreak || body.humanDelay) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            blockStreamingDefault: body.blockStreaming || undefined,
            blockStreamingBreak: body.blockStreamingBreak || undefined,
            humanDelay: body.humanDelay === 'natural'
              ? { mode: 'natural' }
              : body.humanDelay === 'custom'
                ? { mode: 'custom', minMs: body.humanDelayMin, maxMs: body.humanDelayMax }
                : body.humanDelay === 'off' ? { mode: 'off' } : undefined,
          },
        };
      }

      // Telegram stream mode
      if (body.telegramStreamMode) {
        openclawUpdates.channels = {
          ...openclawUpdates.channels,
          telegram: { streamMode: body.telegramStreamMode },
        };
      }

      // Heartbeat config sync
      if (body.heartbeatEnabled !== undefined || body.heartbeatInterval || body.heartbeatTarget || body.heartbeatModel || body.heartbeatPrompt !== undefined || body.heartbeatTo !== undefined || body.heartbeatAccountId !== undefined || body.heartbeatActiveHoursStart !== undefined) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            heartbeat: {
              every: body.heartbeatEnabled === false ? '0m' : (body.heartbeatInterval || '30m'),
              target: body.heartbeatTarget || 'last',
              model: body.heartbeatModel || undefined,
              prompt: body.heartbeatPrompt || undefined,
              ...(body.heartbeatTo ? { to: body.heartbeatTo } : {}),
              ...(body.heartbeatAccountId ? { accountId: body.heartbeatAccountId } : {}),
              ...(body.heartbeatIncludeReasoning !== undefined ? { includeReasoning: body.heartbeatIncludeReasoning } : {}),
              ...(body.heartbeatActiveHoursStart || body.heartbeatActiveHoursEnd ? {
                activeHours: {
                  start: body.heartbeatActiveHoursStart || '08:00',
                  end: body.heartbeatActiveHoursEnd || '22:00',
                  ...(body.heartbeatActiveHoursTimezone ? { timezone: body.heartbeatActiveHoursTimezone } : {}),
                },
              } : {}),
              ...(body.heartbeatAckMaxChars ? { ackMaxChars: body.heartbeatAckMaxChars } : {}),
            },
          },
        };
      }

      // Max concurrent
      if (body.maxConcurrent !== undefined) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            maxConcurrent: body.maxConcurrent,
          },
        };
      }

      // Session advanced sync
      if (body.sessionDmScope || body.sessionAtHour !== undefined || body.sessionIdleMinutes !== undefined || body.sessionMainKey || body.sessionIdentityLinks || body.sessionResetByType !== undefined) {
        openclawUpdates.session = {
          ...openclawUpdates.session,
          ...(body.sessionDmScope ? { dmScope: body.sessionDmScope } : {}),
          ...(body.sessionMainKey ? { mainKey: body.sessionMainKey } : {}),
          ...(body.sessionIdentityLinks ? { identityLinks: body.sessionIdentityLinks } : {}),
          ...(body.sessionAtHour !== undefined || body.sessionIdleMinutes !== undefined ? {
            reset: {
              mode: body.sessionResetMode || 'daily',
              atHour: body.sessionAtHour ?? 4,
              idleMinutes: body.sessionIdleMinutes ?? 120,
            },
          } : {}),
          ...(body.sessionResetByType ? { resetByType: body.sessionResetByType } : {}),
        };
      }

      // Sandbox config sync
      if (body.sandboxMode || body.sandboxScope || body.sandboxWorkspaceAccess || body.sandboxNetwork || body.sandboxBrowser !== undefined || body.sandboxDockerImage !== undefined || body.sandboxSetupCommand !== undefined) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            sandbox: {
              mode: body.sandboxMode || 'off',
              scope: body.sandboxScope || 'session',
              workspaceAccess: body.sandboxWorkspaceAccess || 'none',
              docker: {
                network: body.sandboxNetwork || 'none',
                ...(body.sandboxSetupCommand ? { setupCommand: body.sandboxSetupCommand } : {}),
                ...(body.sandboxDockerImage ? { image: body.sandboxDockerImage } : {}),
                ...(body.sandboxMemory ? { memory: body.sandboxMemory } : {}),
                ...(body.sandboxCpus ? { cpus: body.sandboxCpus } : {}),
                ...(body.sandboxPidsLimit ? { pidsLimit: body.sandboxPidsLimit } : {}),
                ...(body.sandboxDns?.length ? { dns: body.sandboxDns } : {}),
                ...(body.sandboxExtraHosts?.length ? { extraHosts: body.sandboxExtraHosts } : {}),
              },
              browser: body.sandboxBrowser !== undefined ? { enabled: body.sandboxBrowser } : undefined,
              ...(body.sandboxPruneIdleHours || body.sandboxMaxAgeDays ? {
                prune: {
                  ...(body.sandboxPruneIdleHours ? { idleHours: body.sandboxPruneIdleHours } : {}),
                  ...(body.sandboxMaxAgeDays ? { maxAgeDays: body.sandboxMaxAgeDays } : {}),
                },
              } : {}),
            },
          },
        };
      }

      // Tools advanced sync
      if (body.toolAlsoAllow || body.toolMediaMaxSize !== undefined || body.toolSubagentAllow || body.toolSubagentDeny) {
        openclawUpdates.tools = {
          ...openclawUpdates.tools,
          ...(body.toolAlsoAllow ? { alsoAllow: body.toolAlsoAllow } : {}),
          ...(body.toolMediaMaxSize ? { media: { maxSize: body.toolMediaMaxSize } } : {}),
          ...(body.toolSubagentAllow || body.toolSubagentDeny ? {
            subagent: {
              ...(body.toolSubagentAllow ? { allow: body.toolSubagentAllow } : {}),
              ...(body.toolSubagentDeny ? { deny: body.toolSubagentDeny } : {}),
            },
          } : {}),
        };
      }

      // Voice Call plugin config sync
      if (body.voiceCallEnabled !== undefined || body.voiceCallProvider) {
        openclawUpdates.plugins = {
          entries: {
            'voice-call': {
              enabled: body.voiceCallEnabled ?? false,
              config: {
                provider: body.voiceCallProvider || 'disabled',
                ...(body.voiceCallProvider === 'twilio' ? {
                  twilio: {
                    accountSid: body.voiceCallTwilioSid,
                    authToken: body.voiceCallTwilioToken,
                    from: body.voiceCallFrom,
                  },
                } : {}),
              },
            },
          },
        };
      }

      // Hooks config sync
      if (body.hooksEnabled !== undefined || body.hooksMappings !== undefined || body.hooksPresets) {
        openclawUpdates.hooks = {
          enabled: body.hooksEnabled ?? true,
          token: body.hooksToken || undefined,
          path: '/hooks',
          presets: body.hooksPresets || [],
          ...(body.hooksMappings?.length ? {
            mappings: body.hooksMappings.map((m: any) => ({
              match: { path: m.matchPath },
              action: m.action || 'agent',
              ...(m.agentId ? { agentId: m.agentId } : {}),
              ...(m.sessionKey ? { sessionKey: m.sessionKey } : {}),
              ...(m.messageTemplate ? { messageTemplate: m.messageTemplate } : {}),
              ...(m.deliver ? { deliver: true } : {}),
              ...(m.channel ? { channel: m.channel } : {}),
              ...(m.to ? { to: m.to } : {}),
            })),
          } : {}),
        };
      }

      // OpenAI API toggle
      if (body.apiEnabled !== undefined || body.responsesApiEnabled !== undefined) {
        openclawUpdates.gateway = {
          ...openclawUpdates.gateway,
          http: {
            endpoints: {
              chatCompletions: { enabled: body.apiEnabled ?? updates['config.apiEnabled'] ?? true },
              responses: { enabled: body.responsesApiEnabled ?? updates['config.responsesApiEnabled'] ?? false },
            },
          },
        };
      }

      // Lobster workflow plugin toggle
      if (body.lobsterEnabled !== undefined) {
        openclawUpdates.plugins = {
          ...openclawUpdates.plugins,
          entries: {
            ...(openclawUpdates.plugins as any)?.entries,
            lobster: { enabled: body.lobsterEnabled },
          },
        };
      }


      // Logging level
      if (body.loggingLevel) {
        openclawUpdates.logging = { level: body.loggingLevel };
      }

      // Image model
      if (body.imageModel !== undefined) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            imageModel: body.imageModel || undefined,
          },
        };
      }

      // TTS config
      if (body.ttsEnabled !== undefined) {
        openclawUpdates.messages = {
          ...openclawUpdates.messages,
          tts: {
            enabled: body.ttsEnabled,
            ...(body.ttsProvider ? { provider: body.ttsProvider } : {}),
            ...(body.ttsVoice ? { voice: body.ttsVoice } : {}),
          },
        };
      }

      // Skills advanced
      if (body.skillsAllowBundled !== undefined || body.skillsExtraDirs) {
        openclawUpdates.skills = {
          ...openclawUpdates.skills,
          load: {
            ...((openclawUpdates.skills as any)?.load || {}),
            ...(body.skillsAllowBundled !== undefined ? { allowBundled: body.skillsAllowBundled } : {}),
            ...(body.skillsExtraDirs ? { extraDirs: body.skillsExtraDirs } : {}),
          },
        };
      }

      // Memory search advanced
      if (body.memorySearchExtraPaths || body.memorySearchBatchEnabled !== undefined) {
        openclawUpdates.agents = {
          ...openclawUpdates.agents,
          defaults: {
            ...openclawUpdates.agents?.defaults,
            memorySearch: {
              ...((openclawUpdates.agents?.defaults as any)?.memorySearch || {}),
              ...(body.memorySearchExtraPaths ? { extraPaths: body.memorySearchExtraPaths } : {}),
              ...(body.memorySearchBatchEnabled !== undefined ? { batch: { enabled: body.memorySearchBatchEnabled } } : {}),
            },
          },
        };
      }

      if (Object.keys(openclawUpdates).length > 0) {
        await deploymentService.updateAgentConfig(agentId, openclawUpdates);
      }
    } catch (err) {
      // Config sync failure is non-fatal -- agent DB is updated
      console.warn(`Failed to sync config to container for agent ${agentId}:`, err);
    }

    // Persona files (AGENTS.md, SOUL.md, IDENTITY.md) are now edited directly
    // in the workspace — no auto-regeneration from config fields.

    // Audit: Config-Änderung dokumentieren
    const changedFields = Object.keys(body).filter(k => body[k] !== undefined);
    const isModelChange = changedFields.some(f => ['model', 'fallbackModels'].includes(f));
    const isToolChange = changedFields.some(f => ['toolProfile', 'toolAllow', 'toolDeny'].includes(f));
    const isSandboxChange = changedFields.some(f => f.startsWith('sandbox'));
    const riskLevel = isSandboxChange ? 'high' as const : isToolChange ? 'high' as const : isModelChange ? 'medium' as const : 'low' as const;

    // Fetch agent name for audit (lightweight projection)
    const auditAgent = await agentsCollection.findOne(
      { _id: new ObjectId(agentId), organizationId: request.organizationId },
      { projection: { name: 1 } },
    );
    const agentName = auditAgent?.name || agentId;

    if (request.audit) {
      await request.audit({
        agentId,
        agentName,
        category: isModelChange ? 'agent.config' : isToolChange ? 'agent.config' : 'agent.config',
        action: isModelChange ? 'agent.config.model_changed' : isToolChange ? 'agent.config.tools_changed' : isSandboxChange ? 'agent.config.sandbox_changed' : 'agent.config.updated',
        title: `Agent "${agentName}" Konfiguration aktualisiert`,
        description: `${changedFields.length} Feld(er) geändert: ${changedFields.join(', ')}`,
        reasoning: isModelChange ? `Modellwechsel: Benutzer hat das primäre oder Fallback-Modell geändert` :
          isToolChange ? `Tool-Policy geändert: Auswirkung auf Agent-Berechtigungen` :
          isSandboxChange ? `Sandbox-Konfiguration geändert: Auswirkung auf Sicherheitsisolierung` :
          `Konfigurationsänderung durch Benutzer`,
        riskLevel,
        outcome: 'success',
        resource: { type: 'agent', id: agentId, name: agentName },
        changes: changedFields.map(field => ({
          field,
          before: undefined,
          after: body[field],
        })),
        metadata: { changedFieldCount: changedFields.length, syncedToContainer: true },
      });
    }

    return { success: true };
  });
}
