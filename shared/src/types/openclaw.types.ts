// OpenClaw Integration Types
// Full configuration schema matching the OpenClaw Gateway config reference

// ── Gateway Configuration ─────────────────────────────────────────

export interface GatewayConfig {
  port?: number;
  bind?: string;
  mode?: 'local' | 'remote';
  auth?: {
    mode?: 'token' | 'password' | 'none';
    token?: string;
    password?: string;
  };
  trustedProxies?: string[];
  /** CIDR ranges treated as local for auto-pairing. OpenClaw PR #18441. */
  localNetworks?: string[];
  http?: {
    endpoints?: {
      chatCompletions?: { enabled: boolean };
      responses?: { enabled: boolean };
    };
  };
  controlUi?: {
    enabled?: boolean;
    basePath?: string;
    allowInsecureAuth?: boolean;
    dangerouslyDisableDeviceAuth?: boolean;
  };
  remote?: {
    url?: string;
    token?: string;
    password?: string;
  };
}

// ── Model Configuration ───────────────────────────────────────────

export interface ModelConfig {
  primary: string;
  fallbacks?: string[];
}

export interface ModelEntry {
  alias?: string;
  params?: {
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    [key: string]: unknown;
  };
}

// ── Sandbox Configuration ─────────────────────────────────────────

export interface SandboxDockerConfig {
  image?: string;
  network?: string;
  setupCommand?: string;
  env?: Record<string, string>;
  readOnlyRoot?: boolean;
  user?: string;
}

export interface SandboxConfig {
  enabled?: boolean;
  mode?: 'off' | 'non-main' | 'all';
  scope?: 'session' | 'agent' | 'shared';
  workspaceAccess?: 'rw' | 'ro' | 'none';
  workspaceRoot?: string;
  docker?: SandboxDockerConfig;
}

// ── Memory Search Configuration ───────────────────────────────────

export interface MemorySearchConfig {
  provider?: 'openai' | 'gemini' | 'voyage' | 'local' | 'none';
  model?: string;
  fallback?: 'openai' | 'gemini' | 'voyage' | 'local' | 'none';
  local?: {
    modelPath?: string;
  };
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    batch?: {
      enabled?: boolean;
      concurrency?: number;
      wait?: boolean;
      pollIntervalMs?: number;
      timeoutMinutes?: number;
    };
  };
  sync?: {
    watch?: boolean;
  };
  sources?: Array<'memory' | 'sessions'>;
  fallbackProvider?: 'openai' | 'gemini' | 'voyage';
  /** Experimental flags (e.g. sessionMemory search) */
  experimental?: {
    sessionMemory?: boolean;
  };
}

// ── Streaming Configuration ───────────────────────────────────────

export type BlockStreamingBreak = 'text_end' | 'message_end';

export interface HumanDelayConfig {
  mode: 'off' | 'natural' | 'custom';
  minMs?: number;
  maxMs?: number;
}

export interface StreamingConfig {
  blockStreamingDefault?: 'on' | 'off';
  blockStreamingBreak?: BlockStreamingBreak;
  humanDelay?: HumanDelayConfig;
}

// ── Thinking / Reasoning Configuration ───────────────────────────

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningVisibility = 'on' | 'off' | 'stream';

export interface ThinkingConfig {
  level?: ThinkingLevel;
  reasoningVisibility?: ReasoningVisibility;
}

// ── Heartbeat Configuration ──────────────────────────────────────

export interface HeartbeatConfig {
  every?: string; // e.g. "30m", "1h", "0m" (disabled)
  target?: 'last' | 'whatsapp' | 'telegram' | 'discord' | 'none';
  model?: string;
  prompt?: string;
}

// ── Voice Call Plugin Configuration ──────────────────────────────

export type VoiceCallProvider = 'twilio' | 'telnyx' | 'plivo' | 'disabled';

export interface VoiceCallConfig {
  enabled?: boolean;
  provider?: VoiceCallProvider;
  twilio?: {
    accountSid?: string;
    authToken?: string;
    from?: string;
  };
  telnyx?: {
    apiKey?: string;
    from?: string;
  };
  plivo?: {
    authId?: string;
    authToken?: string;
    from?: string;
  };
  inboundPolicy?: 'notify' | 'conversation';
  tts?: {
    provider?: 'openai' | 'elevenlabs';
    voice?: string;
  };
}

// ── Lobster Workflow Configuration ───────────────────────────────

export interface WorkflowStep {
  id: string;
  type: 'command' | 'llm_task' | 'approval' | 'condition' | 'message';
  command: string;
  label?: string;
  stdin?: string;
  approval?: 'required' | 'optional';
  condition?: string;
  params?: Record<string, string>;
}

export interface LobsterWorkflow {
  name: string;
  description?: string;
  content: string; // YAML content (source of truth for Lobster)
  steps?: WorkflowStep[]; // Structured representation for UI
  status?: 'active' | 'paused' | 'completed';
  lastRun?: Date;
  createdAt?: Date;
}

// ── Agent Configuration ───────────────────────────────────────────

export interface AgentDefaults {
  model?: ModelConfig;
  models?: Record<string, ModelEntry>;
  imageModel?: string;
  /** Downscale images before sending to LLM (default: 1200) */
  imageMaxDimensionPx?: number;
  maxConcurrent?: number;
  workspace?: string;
  sandbox?: SandboxConfig | boolean;
  bootstrapMaxChars?: number;
  memorySearch?: MemorySearchConfig;
  groupChat?: {
    mentionPatterns?: string[];
  };
  heartbeat?: HeartbeatConfig;
  thinking?: ThinkingConfig;
  blockStreamingDefault?: 'on' | 'off';
  blockStreamingBreak?: BlockStreamingBreak;
  blockStreamingChunk?: { minChars?: number; maxChars?: number; breakPreference?: string };
  humanDelay?: HumanDelayConfig;
  /** Show typing indicator in channels while the agent is running */
  typingMode?: 'instant' | 'thinking' | 'message' | 'off';
  typingIntervalSeconds?: number;
  /** Compaction strategy + pre-compaction memory flush */
  compaction?: {
    mode?: 'default' | 'safeguard';
    reserveTokensFloor?: number;
    memoryFlush?: {
      enabled?: boolean;
      softThresholdTokens?: number;
      systemPrompt?: string;
      prompt?: string;
    };
  };
  /** In-memory context pruning of old tool results before each LLM call */
  contextPruning?: {
    mode?: 'cache-ttl';
    ttl?: string;
    keepLastAssistants?: number;
    softTrimRatio?: number;
    hardClearRatio?: number;
    softTrim?: { maxChars?: number; headChars?: number; tailChars?: number };
    hardClear?: { enabled?: boolean; placeholder?: string };
  };
  /** Sub-agent defaults (model, archive timeout, allowed agents for sessions_spawn) */
  subagents?: {
    model?: string;
    archiveAfterMinutes?: number;
    thinking?: string;
    /** Allowed agent IDs for sessions_spawn cross-agent calls (OpenClaw 2026.2.x+) */
    allowAgents?: string[];
  };
}

export interface AgentEntry {
  id: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  tools?: {
    profile?: ToolProfile;
    allow?: string[];
    deny?: string[];
    elevated?: {
      enabled?: boolean;
      mode?: 'on' | 'off' | 'ask' | 'full';
    };
  };
  sandbox?: SandboxConfig;
  groupChat?: {
    mentionPatterns?: string[];
  };
}

export interface AgentsConfig {
  defaults?: AgentDefaults;
  list?: AgentEntry[];
}

// ── Binding (Multi-Agent Routing) ─────────────────────────────────

export interface BindingMatch {
  channel?: ChannelType;
  accountId?: string;
  peer?: {
    kind?: 'direct' | 'group';
    id?: string;
  };
  guildId?: string;
  teamId?: string;
}

export interface Binding {
  agentId: string;
  match: BindingMatch;
}

// ── Channel Configuration ─────────────────────────────────────────

export type ChannelType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'signal'
  | 'imessage'
  | 'bluebubbles'
  | 'webchat'
  | 'googlechat'
  | 'msteams'
  | 'mattermost'
  | 'matrix'
  | 'feishu'
  | 'line'
  | 'superchat';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist' | 'disabled';

export interface RetryConfig {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
}

export interface ChannelAccountConfig {
  accountId?: string;
  default?: boolean;
}

export interface WhatsAppChannelConfig {
  enabled?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean }>;
  retry?: RetryConfig;
  accounts?: (ChannelAccountConfig & { tokenFile?: string })[];
  // Advanced WhatsApp fields
  textChunkLimit?: number;
  chunkMode?: 'split' | 'truncate';
  mediaMaxMb?: number;
  sendReadReceipts?: boolean;
  ackReaction?: string;
  multiAccount?: boolean;
}

export interface TelegramChannelConfig {
  enabled?: boolean;
  botToken?: string;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean }>;
  capabilities?: string[];
  retry?: RetryConfig;
  // Advanced Telegram fields
  streamMode?: 'off' | 'partial' | 'block';
  draftChunkMinChars?: number;
  draftChunkMaxChars?: number;
  customCommands?: string[];
  topicsEnabled?: boolean;
  linkPreview?: boolean;
}

export interface DiscordChannelConfig {
  enabled?: boolean;
  token?: string;
  dm?: {
    enabled?: boolean;
    policy?: DmPolicy;
    allowFrom?: string[];
  };
  guilds?: Record<string, { requireMention?: boolean }>;
  retry?: RetryConfig;
  // Advanced Discord fields
  replyToMode?: 'reply' | 'reference' | 'none';
  nativeCommands?: boolean;
  historyLimit?: number;
  agentComponents?: boolean;
}

export interface SlackChannelConfig {
  enabled?: boolean;
  botToken?: string;
  appToken?: string;
  dm?: {
    enabled?: boolean;
    policy?: DmPolicy;
    allowFrom?: string[];
  };
  channels?: Record<string, { requireMention?: boolean }>;
  retry?: RetryConfig;
  // Advanced Slack fields
  threadMode?: 'reply' | 'broadcast';
  slashCommand?: string;
  userToken?: string;
  mode?: 'socket' | 'http';
}

export interface LineChannelConfig extends BaseChannelConfig {
  channelAccessToken?: string;
  channelSecret?: string;
}

// WebChat is NOT an OpenClaw channel — it's the built-in Gateway WebSocket UI.
// It works automatically without config. Do NOT add channels.webchat to OpenClaw config.
// We keep 'webchat' in ChannelType for our DB/UI layer (virtual channel for display).

/** Base interface for channels not yet fully typed */
export interface BaseChannelConfig {
  enabled?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  retry?: RetryConfig;
  [key: string]: unknown;
}

export interface SignalChannelConfig extends BaseChannelConfig {
  /** Signal phone number in E.164 format (e.g. +1234567890) */
  phoneNumber?: string;
}

export interface IMessageChannelConfig extends BaseChannelConfig {
  /** iMessage email or phone for BlueBubbles/AirMessage bridge */
  bridgeUrl?: string;
  bridgePassword?: string;
}

export interface GoogleChatChannelConfig extends BaseChannelConfig {
  serviceAccountKey?: string;
}

export interface MSTeamsChannelConfig extends BaseChannelConfig {
  appId?: string;
  appSecret?: string;
  tenantId?: string;
}

export interface MattermostChannelConfig extends BaseChannelConfig {
  url?: string;
  botToken?: string;
}

export interface MatrixChannelConfig extends BaseChannelConfig {
  homeserverUrl?: string;
  accessToken?: string;
  userId?: string;
}

export interface FeishuChannelConfig extends BaseChannelConfig {
  appId?: string;
  appSecret?: string;
}

export interface ChannelsConfig {
  whatsapp?: WhatsAppChannelConfig;
  telegram?: TelegramChannelConfig;
  discord?: DiscordChannelConfig;
  slack?: SlackChannelConfig;
  // NO webchat here — it's not a real OpenClaw channel
  signal?: SignalChannelConfig;
  imessage?: IMessageChannelConfig;
  googlechat?: GoogleChatChannelConfig;
  msteams?: MSTeamsChannelConfig;
  mattermost?: MattermostChannelConfig;
  matrix?: MatrixChannelConfig;
  feishu?: FeishuChannelConfig;
  line?: LineChannelConfig;
  bluebubbles?: IMessageChannelConfig;
}

// ── Session Configuration ─────────────────────────────────────────

export type SessionScope = 'per-sender' | 'per-channel' | 'per-group' | 'global';
export type SessionDmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
export type SessionResetMode = 'daily' | 'idle' | 'manual';

export interface SessionResetConfig {
  mode?: SessionResetMode;
  atHour?: number;
  idleMinutes?: number;
}

export interface SessionConfig {
  scope?: SessionScope;
  dmScope?: SessionDmScope;
  identityLinks?: Record<string, string[]>;
  reset?: SessionResetConfig;
  resetByType?: {
    thread?: SessionResetConfig;
    direct?: SessionResetConfig;
    group?: SessionResetConfig;
  };
  resetByChannel?: Record<string, SessionResetConfig>;
  resetTriggers?: string[];
  store?: string;
  mainKey?: string;
}

// ── Tool Configuration ────────────────────────────────────────────

export type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full';

export type ToolGroup =
  | 'group:runtime'
  | 'group:fs'
  | 'group:sessions'
  | 'group:memory'
  | 'group:web'
  | 'group:ui'
  | 'group:automation'
  | 'group:messaging'
  | 'group:nodes'
  | 'group:openclaw';

export interface ExecToolConfig {
  backgroundMs?: number;
  timeoutSec?: number;
  cleanupMs?: number;
  notifyOnExit?: boolean;
  host?: string;
  security?: string;
  ask?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  applyPatch?: {
    enabled?: boolean;
    allowModels?: string[];
  };
}

export interface WebToolConfig {
  search?: {
    enabled?: boolean;
    provider?: 'brave' | 'perplexity' | 'grok';
    apiKey?: string;
    maxResults?: number;
  };
  fetch?: {
    enabled?: boolean;
    maxCharsCap?: number;
  };
}

export interface MediaToolConfig {
  concurrency?: number;
  models?: Array<{
    provider?: string;
    model?: string;
    capabilities?: ('image' | 'audio' | 'video')[];
  }>;
  entries?: Array<{
    type?: 'provider' | 'cli';
    provider?: string;
    model?: string;
    command?: string;
    args?: string[];
    capabilities?: ('image' | 'audio' | 'video')[];
    prompt?: string;
    maxChars?: number;
  }>;
  audio?: {
    enabled?: boolean;
    maxBytes?: number;
    echoTranscript?: boolean;
    echoFormat?: string;
  };
  image?: {
    enabled?: boolean;
    maxBytes?: number;
  };
  video?: {
    enabled?: boolean;
    maxBytes?: number;
  };
}

export interface ElevatedToolConfig {
  enabled?: boolean;
  mode?: 'on' | 'off' | 'ask' | 'full';
  allowFrom?: string[];
}

export interface ToolsConfig {
  profile?: ToolProfile;
  allow?: (string | ToolGroup)[];
  deny?: (string | ToolGroup)[];
  alsoAllow?: string[];
  exec?: ExecToolConfig;
  web?: WebToolConfig;
  media?: MediaToolConfig;
  elevated?: ElevatedToolConfig;
  sandbox?: {
    tools?: {
      allow?: string[];
      deny?: string[];
    };
  };
  /** Loop detection: prevents agent infinite loops in autonomous workflows (OpenClaw 2026.2.x+) */
  loopDetection?: { enabled?: boolean };
  /** Agent-to-agent tool config (sessions_spawn cross-agent; OpenClaw 2026.2.x+) */
  agentToAgent?: { enabled?: boolean; allow?: string[] };
}

// ── Skills Configuration ──────────────────────────────────────────

export interface SkillEntry {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
  /** Least-privilege tool permissions for this skill (e.g. ['group:fs', 'web_search']) */
  permissions?: string[];
}

export interface SkillsConfig {
  allowBundled?: string[];
  load?: {
    extraDirs?: string[];
    watch?: boolean;
    watchDebounceMs?: number;
  };
  install?: {
    preferBrew?: boolean;
    nodeManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  };
  entries?: Record<string, SkillEntry>;
}

// ── Cron / Automation Configuration ───────────────────────────────

export interface CronConfig {
  enabled?: boolean;
}

export interface CronJobConfig {
  name: string;
  schedule?: { kind: 'cron'; expr: string; tz?: string } | { kind: 'every'; everyMs: number } | { kind: 'at'; at: string };
  sessionTarget?: 'main' | 'isolated';
  payload?: { kind: 'agentTurn'; message: string } | { kind: 'systemEvent'; text: string };
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  delivery?: { mode: 'announce' | 'webhook' | 'none'; to?: string };
}

// ── Hooks / Webhooks Configuration ────────────────────────────────

export interface HookMapping {
  match: { path?: string; source?: string };
  action: 'agent' | 'relay' | 'wake';
  name?: string;
  agentId?: string;
  sessionKey?: string;
  messageTemplate?: string;
  deliver?: boolean;
  channel?: string;
  to?: string;
}

export interface HooksConfig {
  enabled?: boolean;
  token?: string;
  path?: string;
  presets?: string[];
  mappings?: HookMapping[];
  /** Fixed session key for webhook runs (2026.2.12+ security) */
  defaultSessionKey?: string;
  /** Disable request-level sessionKey overrides (default: false) */
  allowRequestSessionKey?: boolean;
  /** Restrict sessionKey prefixes when overrides allowed */
  allowedSessionKeyPrefixes?: string[];
  /** Internal bundled hooks (session-memory, command-logger, etc.) */
  internal?: {
    entries?: Record<string, { enabled: boolean }>;
  };
}

// ── Browser Configuration ─────────────────────────────────────────

export interface BrowserProfileConfig {
  cdpPort?: number;
  cdpUrl?: string;
  color?: string;
}

export interface BrowserConfig {
  enabled?: boolean;
  defaultProfile?: 'chrome' | 'openclaw';
  headless?: boolean;
  noSandbox?: boolean;
  attachOnly?: boolean;
  executablePath?: string;
  color?: string;
  remoteCdpTimeoutMs?: number;
  remoteCdpHandshakeTimeoutMs?: number;
  profiles?: Record<string, BrowserProfileConfig>;
}

// ── Messages Configuration ────────────────────────────────────────

export interface TtsConfig {
  enabled?: boolean;
  provider?: 'openai' | 'elevenlabs';
  voice?: string;
}

export interface MessagesConfig {
  groupChat?: {
    mentionPatterns?: string[];
  };
  tts?: TtsConfig;
}

export interface LoggingConfig {
  level?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  redactSensitive?: 'off' | 'tools' | 'all';
  format?: 'text' | 'json';
}

// ── Model Providers Configuration ─────────────────────────────────

export interface ModelProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  api?: 'anthropic-messages' | 'openai-completions' | 'openai-responses' | 'google-generative-ai';
  models?: Record<string, {
    id?: string;
    name?: string;
    reasoning?: boolean;
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input?: number; output?: number };
  }>;
}

export interface ModelsConfig {
  mode?: 'merge' | 'replace';
  providers?: {
    anthropic?: ModelProviderConfig;
    openai?: ModelProviderConfig;
    openrouter?: ModelProviderConfig;
    google?: ModelProviderConfig;
    groq?: ModelProviderConfig;
    [key: string]: ModelProviderConfig | undefined;
  };
}

// ── Auth Configuration ────────────────────────────────────────────

export interface AuthConfig {
  order?: Record<string, string[]>;
  cooldowns?: {
    billingBackoffHours?: number;
  };
}

// ── Plugins Configuration ─────────────────────────────────────────

export interface PluginsConfig {
  load?: { paths?: string[] };
  slots?: {
    memory?: string; // 'memory-core' | 'memory-lancedb' | 'none'
  };
  entries?: Record<string, { enabled: boolean; config?: Record<string, unknown> }>;
}

// ══════════════════════════════════════════════════════════════════
// Full OpenClaw Config (matches ~/.openclaw/openclaw.json schema)
// ══════════════════════════════════════════════════════════════════

export interface WebProviderConfig {
  enabled?: boolean;
  heartbeatSeconds?: number;
  reconnect?: {
    initialMs?: number;
    maxMs?: number;
    factor?: number;
    jitter?: number;
    maxAttempts?: number;
  };
}

// ── Commands Configuration (root-level) ───────────────────────────
// Docs: https://docs.openclaw.ai/gateway/configuration-reference#commands
// Controls chat command handling. Must be at root level, NOT under gateway.

export interface CommandsConfig {
  native?: 'auto' | boolean;
  text?: boolean;
  bash?: boolean;
  bashForegroundMs?: number;
  config?: boolean;
  debug?: boolean;
  restart?: boolean;
  allowFrom?: Record<string, string[]>;
  useAccessGroups?: boolean;
}

export interface OpenClawFullConfig {
  gateway?: GatewayConfig;
  commands?: CommandsConfig;
  agents?: AgentsConfig;
  bindings?: Binding[];
  channels?: ChannelsConfig;
  web?: WebProviderConfig;
  session?: SessionConfig;
  tools?: ToolsConfig;
  skills?: SkillsConfig;
  models?: ModelsConfig;
  auth?: AuthConfig;
  cron?: CronConfig;
  hooks?: HooksConfig;
  browser?: BrowserConfig;
  messages?: MessagesConfig;
  plugins?: PluginsConfig;
  logging?: LoggingConfig;
  wizard?: {
    lastRunAt: string;
    lastRunVersion: string;
    lastRunCommand: string;
    lastRunMode: string;
  };
  discovery?: {
    mdns?: { mode: 'off' | 'on' };
  };
}

// ══════════════════════════════════════════════════════════════════
// Legacy simplified config (kept for backward compat)
// ══════════════════════════════════════════════════════════════════

/** @deprecated Use OpenClawFullConfig instead */
export interface OpenClawConfig {
  model: string;
  prompts: {
    system: string;
    agents?: string;
    soul?: string;
  };
  tools: {
    profile: ToolProfile;
    allow?: string[];
    deny?: string[];
  };
  skills: string[];
  channels?: string[];

  // Security settings
  security?: {
    gatewayAllowlist?: string[];
    shellAutoApprove?: boolean;
    pathSanitization?: boolean;
    networkEgress?: string[];
  };
}

// ══════════════════════════════════════════════════════════════════
// Deployment Types
// ══════════════════════════════════════════════════════════════════

export interface DeploymentConfig {
  agentId: string;
  userId: string;
  organizationId?: string;
  templateId?: string;
  name: string;
  description: string;
  model: string;
  fallbackModels?: string[];
  useCase?: string;
  systemPrompt?: string;
  soulPrompt?: string;
  identityName?: string;
  skills?: string[];
  /** Per-skill tool permissions derived at deploy time */
  skillPermissions?: Record<string, string[]>;
  channels?: ChannelDeployConfig[];
  toolProfile?: ToolProfile;
  toolAllow?: string[];
  toolDeny?: string[];
  toolAlsoAllow?: string[];
  toolMediaMaxSize?: number;      // max upload in MB
  toolSubagentAllow?: string[];
  toolSubagentDeny?: string[];
  sessionConfig?: {
    scope?: SessionScope;
    dmScope?: SessionDmScope;
    resetMode?: SessionResetMode;
    resetTriggers?: string[];
    // Advanced session fields
    atHour?: number;               // 0-23, hour for daily reset
    idleMinutes?: number;          // idle timeout in minutes
    mainKey?: string;              // session main key (default "main")
    identityLinks?: Record<string, string[]>; // provider-prefixed -> canonical IDs
    resetByType?: {                // separate reset config for direct/group
      direct?: { mode?: SessionResetMode; atHour?: number; idleMinutes?: number };
      group?: { mode?: SessionResetMode; atHour?: number; idleMinutes?: number };
    };
  };
  memoryConfig?: {
    provider?: 'openai' | 'gemini' | 'voyage' | 'local' | 'none';
  };
  cronJobs?: CronJobConfig[];
  webhookConfig?: {
    enabled?: boolean;
    token?: string;
    mappings?: HookMapping[];
  };

  // ── Advanced Config Fields (from Deep Agent Config) ──────────
  maxConcurrent?: number;

  // Streaming
  blockStreaming?: 'on' | 'off';
  blockStreamingBreak?: BlockStreamingBreak;
  blockStreamingChunkMin?: number;
  blockStreamingChunkMax?: number;
  blockStreamingCoalesceIdleMs?: number;
  humanDelay?: 'off' | 'natural' | 'custom';
  humanDelayMin?: number;
  humanDelayMax?: number;
  telegramStreamMode?: 'off' | 'partial' | 'block';
  telegramDraftChunkMin?: number;
  telegramDraftChunkMax?: number;

  // Thinking
  thinkingLevel?: ThinkingLevel;
  reasoningVisibility?: ReasoningVisibility;

  // Heartbeat
  heartbeatEnabled?: boolean;
  heartbeatInterval?: string;
  heartbeatTarget?: string;
  heartbeatModel?: string;
  heartbeatPrompt?: string;
  heartbeatTo?: string;
  heartbeatAccountId?: string;
  heartbeatIncludeReasoning?: boolean;
  heartbeatTasks?: string[];
  heartbeatActiveHoursStart?: string;  // e.g. "08:00"
  heartbeatActiveHoursEnd?: string;    // e.g. "22:00"
  heartbeatActiveHoursTimezone?: string; // IANA timezone
  heartbeatAckMaxChars?: number;

  // Sandbox
  sandboxMode?: 'off' | 'non-main' | 'all';
  sandboxScope?: 'session' | 'agent' | 'shared';
  sandboxWorkspaceAccess?: 'none' | 'ro' | 'rw';
  sandboxNetwork?: 'none' | 'bridge';
  sandboxBrowser?: boolean;
  sandboxDockerImage?: string;
  sandboxSetupCommand?: string;
  sandboxMemory?: string;          // e.g. "1g"
  sandboxCpus?: number;
  sandboxPidsLimit?: number;
  sandboxDns?: string[];
  sandboxExtraHosts?: string[];
  sandboxPruneIdleHours?: number;
  sandboxMaxAgeDays?: number;
  sandboxBrowserHostControl?: boolean;

  // Voice Call
  voiceCallEnabled?: boolean;
  voiceCallProvider?: VoiceCallProvider;
  voiceCallTwilioSid?: string;
  voiceCallTwilioToken?: string;
  voiceCallFrom?: string;
  voiceCallInboundPolicy?: 'notify' | 'conversation';
  voiceCallTtsProvider?: 'openai' | 'elevenlabs';
  voiceCallTtsVoice?: string;

  // Hooks
  hooksEnabled?: boolean;
  hooksToken?: string;
  hooksPresets?: string[];

  // OpenAI API
  apiEnabled?: boolean;
  responsesApiEnabled?: boolean;

  // Lobster Workflow Runtime
  lobsterEnabled?: boolean;


  // Channel Advanced (per-channel overrides stored as object)
  channelAdvanced?: Record<string, any>;

  // Memory Advanced
  memorySearchExtraPaths?: string[];
  memorySearchBatchEnabled?: boolean;

  // Skills Advanced
  skillsAllowBundled?: boolean;
  skillsExtraDirs?: string[];

  // Logging
  loggingLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';

  // Browser
  browserEnabled?: boolean;
  browserProfilesEnabled?: boolean;

  // TTS
  ttsEnabled?: boolean;
  ttsProvider?: 'openai' | 'elevenlabs';
  ttsVoice?: string;

  // Image Model
  imageModel?: string;
}

export interface ChannelDeployConfig {
  type: ChannelType;
  credentials?: {
    botToken?: string;
    appToken?: string;
    // Extended credential fields for various channels
    phoneNumber?: string;           // Signal
    bridgeUrl?: string;             // BlueBubbles / iMessage
    bridgePassword?: string;        // BlueBubbles
    channelAccessToken?: string;    // LINE
    channelSecret?: string;         // LINE
    serviceAccountKey?: string;     // Google Chat
    appId?: string;                 // MS Teams
    appPassword?: string;           // MS Teams
    url?: string;                   // Mattermost
    homeserverUrl?: string;         // Matrix
    accessToken?: string;           // Matrix
    userId?: string;                // Matrix
    feishuAppId?: string;           // Feishu
    feishuAppSecret?: string;       // Feishu
    apiKey?: string;                // Superchat
  };
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
  // Advanced per-channel settings
  advanced?: {
    // WhatsApp
    textChunkLimit?: number;
    chunkMode?: 'split' | 'truncate';
    mediaMaxMb?: number;
    sendReadReceipts?: boolean;
    ackReaction?: string;
    multiAccount?: boolean;
    // Telegram
    draftChunkMinChars?: number;
    draftChunkMaxChars?: number;
    customCommands?: string[];
    topicsEnabled?: boolean;
    linkPreview?: boolean;
    // Discord
    replyToMode?: 'reply' | 'reference' | 'none';
    nativeCommands?: boolean;
    historyLimit?: number;
    agentComponents?: boolean;
    // Slack
    threadMode?: 'reply' | 'broadcast';
    slashCommand?: string;
    userToken?: string;
    mode?: 'socket' | 'http';
  };
}

export interface DeploymentResult {
  containerId: string;
  gatewayPort: number;
  gatewayUrl: string;
  gatewayToken: string;
}

export interface ContainerStatus {
  status: 'running' | 'stopped' | 'error';
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  channels?: {
    type: ChannelType;
    connected: boolean;
  }[];
}

// ══════════════════════════════════════════════════════════════════
// Agent Templates
// ══════════════════════════════════════════════════════════════════

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: 'sales' | 'support' | 'marketing' | 'operations' | 'finance';
  icon: string;
  config: Partial<DeploymentConfig>;
  defaultChannels: ChannelType[];
  workspaceTemplates?: {
    agents?: string;
    soul?: string;
    identity?: string;
    tools?: string;
    heartbeat?: string;
  };
  pricing: {
    setup: number;
    monthly: number;
    perOutcome?: number;
  };
}

// ══════════════════════════════════════════════════════════════════
// Workspace Template Types
// ══════════════════════════════════════════════════════════════════

export interface WorkspaceTemplateData {
  agentName: string;
  agentDescription: string;
  systemPrompt: string;
  soulPrompt?: string;
  identityName?: string;
  useCase?: string;
  channels?: ChannelType[];
  skills?: string[];
  organizationName?: string;
  userName?: string;
  heartbeatTasks?: string[];
  /** Which tools are actually available for this agent */
  availableTools?: {
    webSearch: boolean;
    webFetch: boolean;
    browser: boolean;
    message: boolean;
    exec: boolean;
    gateway: boolean;
    cron: boolean;
    memory: boolean;
    fileSystem: boolean;
    superchatSend?: boolean;
  };
  /** The primary model ID so workspace files can reference it */
  primaryModel?: string;
  /** Whether Lobster workflow engine is enabled */
  lobsterEnabled?: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Gateway WebSocket Client Types
// ══════════════════════════════════════════════════════════════════

export interface GatewayWSMessage {
  type: 'req' | 'res' | 'event';
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: unknown;
  error?: string | Record<string, unknown>; // Gateway may send error as object { code, message, ... }
  event?: string;
  seq?: number;
  stateVersion?: number;
}

export interface GatewayConnectParams {
  role: 'operator' | 'node';
  auth?: {
    token?: string;
  };
  caps?: string[];
}

export interface GatewaySession {
  key: string;
  agentId: string;
  channel?: ChannelType;
  peer?: string;
  messageCount: number;
  lastActivityAt?: string;
}

export interface GatewayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  channel?: ChannelType;
  timestamp?: string;
}

// ══════════════════════════════════════════════════════════════════
// ClawHub / Skills Types
// ══════════════════════════════════════════════════════════════════

export interface ClawHubSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  category?: string;
  requirements?: {
    envVars?: string[];
    tools?: string[];
    runtimes?: string[];
  };
  installedAt?: Date;
  // Security / Moderation from ClawHub
  security?: SkillSecurityInfo;
  stats?: SkillStats;
  owner?: SkillOwner;
}

export type SkillSecurityVerdict = 'verified' | 'clean' | 'suspicious' | 'malicious' | 'pending' | 'unknown';

export interface SkillSecurityInfo {
  /** Overall verdict: verified (curated), clean (VT benign), suspicious, malicious, pending, unknown */
  verdict: SkillSecurityVerdict;
  /** Whether download is blocked due to malware */
  isMalwareBlocked: boolean;
  /** Whether the skill has a suspicious flag */
  isSuspicious: boolean;
  /** VirusTotal scan status */
  vtStatus?: 'clean' | 'suspicious' | 'malicious' | 'pending' | 'stale' | 'not_scanned';
  /** VirusTotal Code Insight analysis summary */
  vtAnalysis?: string;
  /** VirusTotal link */
  vtUrl?: string;
  /** When the security check was last performed */
  lastCheckedAt?: string;
  /** Source of the verdict */
  source?: 'clawhub_moderation' | 'virustotal' | 'manual' | 'cached';
}

export interface SkillStats {
  downloads?: number;
  stars?: number;
}

export interface SkillOwner {
  handle?: string;
  displayName?: string;
  image?: string;
}

export interface SkillInstallRequest {
  slug: string;
  agentId: string;
  env?: Record<string, string>;
  apiKey?: string;
}

export interface SkillInstallResult {
  success: boolean;
  skillSlug: string;
  installedPath: string;
}

// ══════════════════════════════════════════════════════════════════
// Gateway RPC Types — typed request/response for each WS RPC method
// ══════════════════════════════════════════════════════════════════

// ── Chat RPC ────────────────────────────────────────────────────

export interface ChatSendParams {
  sessionKey: string;
  text: string;
  idempotencyKey?: string;
}

export interface ChatSendResult {
  runId?: string;
  status?: 'started' | 'in_flight' | 'ok';
}

export interface ChatAbortParams {
  sessionKey: string;
}

export interface ChatInjectParams {
  sessionKey: string;
  text: string;
}

export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
}

// ── Config RPC ──────────────────────────────────────────────────

export interface ConfigGetResult {
  payload?: OpenClawFullConfig;
  config?: OpenClawFullConfig;
  hash?: string;
}

export interface ConfigPatchParams {
  raw: string;
  baseHash: string;
  sessionKey?: string;
  note?: string;
  restartDelayMs?: number;
}

export interface ConfigApplyParams {
  raw: string;
  baseHash?: string;
  sessionKey?: string;
  note?: string;
  restartDelayMs?: number;
}

export interface ConfigSetParams {
  key: string;
  value: unknown;
}

export interface ConfigSchemaResult {
  schema: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
  version?: string;
  generatedAt?: string;
}

// ── Sessions RPC ────────────────────────────────────────────────

export interface SessionsPatchParams {
  sessionKey: string;
  thinking?: boolean;
  verbose?: boolean;
  [key: string]: unknown;
}

// ── Skills RPC ──────────────────────────────────────────────────

export interface GatewaySkillInfo {
  name: string;
  slug?: string;
  description?: string;
  location?: string;
  eligible?: boolean;
  enabled?: boolean;
  missing?: string[];
}

export interface SkillsListResult {
  skills?: GatewaySkillInfo[];
  eligible?: GatewaySkillInfo[];
  all?: GatewaySkillInfo[];
}

// ── Channels RPC ────────────────────────────────────────────────

export interface GatewayChannelStatus {
  type: ChannelType;
  connected: boolean;
  status?: string;
  error?: string;
  accountId?: string;
}

export interface ChannelsStatusResult {
  channels?: GatewayChannelStatus[];
}

// ── Models RPC ──────────────────────────────────────────────────

export interface GatewayModelInfo {
  id: string;
  name?: string;
  provider?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number };
}

export interface ModelsListResult {
  models?: GatewayModelInfo[];
  primary?: string;
  fallbacks?: string[];
}

// ── Health / Status RPC ─────────────────────────────────────────

export interface GatewayHealthResult {
  status: string;
  channels: GatewayChannelStatus[];
  uptime?: number;
}

export interface GatewayStatusResult {
  version?: string;
  uptime?: number;
  agents?: number;
  sessions?: number;
  channels?: GatewayChannelStatus[];
  models?: { primary?: string; fallbacks?: string[] };
  [key: string]: unknown;
}

// ── Presence RPC ────────────────────────────────────────────────

export interface PresenceEntry {
  deviceId: string;
  roles: string[];
  scopes: string[];
  client?: {
    id?: string;
    version?: string;
    platform?: string;
  };
  connectedAt?: string;
}

// ── Nodes RPC ───────────────────────────────────────────────────

export interface GatewayNodeInfo {
  deviceId: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  client?: {
    id?: string;
    version?: string;
    platform?: string;
  };
}

// ── Cron RPC ────────────────────────────────────────────────────

export interface CronJobInfo {
  id: string;
  jobId?: string;
  name: string;
  schedule?: string;
  at?: string;
  every?: string;
  timezone?: string;
  message?: string;
  systemEvent?: string;
  enabled?: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface CronRunInfo {
  id: string;
  jobId: string;
  startedAt: string;
  completedAt?: string;
  status: 'success' | 'error' | 'running';
  error?: string;
}

// ── Exec Approvals RPC ──────────────────────────────────────────

export interface ExecApprovalRequest {
  requestId: string;
  command: string;
  host: 'gateway' | 'node';
  sessionKey?: string;
  createdAt: string;
}

// ── Workspace / Persona RPC ─────────────────────────────────────

export interface WorkspaceFile {
  filename: string;
  content: string;
  size: number;
}

export interface WorkspaceFileInfo {
  filename: string;
  exists: boolean;
  size?: number;
}

export const PERSONA_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const;

export type PersonaFileName = typeof PERSONA_FILES[number];

// ── DM Pairing RPC ──────────────────────────────────────────────

export interface DmPairingRequest {
  code: string;
  sender?: string;
  channel: string;
  createdAt?: string;
  expiresAt?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
}

// ── Channel Login RPC ───────────────────────────────────────────

export interface ChannelLoginStartResult {
  qr?: string;
  qrCode?: string;
  code?: string;
  status?: string;
  channel?: string;
  message?: string;
}

export interface ChannelLoginStatusResult {
  status: 'pending' | 'scanning' | 'connected' | 'error' | 'expired';
  qr?: string;
  qrCode?: string;
  code?: string;
  linked?: boolean;
  connected?: boolean;
  message?: string;
}

// ── Memory Search RPC ───────────────────────────────────────────

export interface MemorySearchResult {
  text?: string;
  snippet?: string;
  file?: string;
  path?: string;
  lineRange?: string;
  score?: number;
  provider?: string;
  model?: string;
  fallback?: boolean;
}
