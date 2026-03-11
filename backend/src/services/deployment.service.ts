// Deployment Service - Full OpenClaw config generation + Docker orchestration

import { writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import type {
  DeploymentConfig,
  DeploymentResult,
  OpenClawFullConfig,
  ChannelDeployConfig,
  ChannelsConfig,
  ToolsConfig,
  ToolProfile,
  SessionConfig,
  SkillsConfig,
  CronConfig,
  HooksConfig,
  MemorySearchConfig,
  WorkspaceTemplateData,
} from '@openclaw-business/shared';
import { config } from '../config/env.js';
import { dockerService } from './docker.service.js';
import { generateWorkspaceFiles } from '../templates/workspace-templates.js';
import { getDatabase } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';
import { ObjectId } from 'mongodb';
import type { AIProvider, AIProviderType, HeartbeatConfig } from '@openclaw-business/shared';
import { PROVIDER_CATALOG } from '@openclaw-business/shared';

export class DeploymentService {
  private basePort = config.openclawBasePort;
  private workspaceDir = config.openclawWorkspaceDir;
  
  // In-memory set of ports currently being provisioned (not yet in DB).
  // Prevents TOCTOU race condition when multiple deployments run concurrently.
  private reservedPorts = new Set<number>();

  // ── Port Management ───────────────────────────────────────────

  private async getAvailablePort(): Promise<number> {
    // Query DB for ALL agents that have a port assigned (any status)
    const db = getDatabase();
    const agents = await db.collection('agents')
      .find(
        { internalPort: { $exists: true, $ne: null } },
        { projection: { internalPort: 1 } }
      )
      .toArray();

    const usedPorts = new Set(agents.map(a => a.internalPort as number).filter(Boolean));

    // Also check Docker for any containers binding ports in our range
    try {
      const containers = await dockerService.listManagedContainers();
      for (const port of containers) {
        usedPorts.add(port);
      }
    } catch {
      // Docker query failed — rely on DB only
    }

    // Merge in-flight reserved ports to prevent TOCTOU race
    for (const rp of this.reservedPorts) {
      usedPorts.add(rp);
    }

    let port = this.basePort;
    while (usedPorts.has(port)) {
      port++;
    }
    
    // Reserve immediately to prevent concurrent allocations
    this.reservedPorts.add(port);
    return port;
  }
  
  /** Release a previously reserved port (call after DB write or on failure) */
  private releasePort(port: number): void {
    this.reservedPorts.delete(port);
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Build paired.json content for pre-seeding device auth.
   *  Uses the same deterministic Ed25519 derivation as GatewayWsClient. */
  private buildPairedJson(agentId: string, token: string): Record<string, unknown> {
    const seed = crypto.createHash('sha256').update(`havoc-device:${agentId}:${token}`).digest();
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const raw = (crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }) as Buffer).subarray(12);
    const deviceId = crypto.createHash('sha256').update(raw).digest('hex');
    const pub = raw.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
    const now = Date.now();
    return {
      [deviceId]: {
        deviceId, publicKey: pub, displayName: 'havoc-operator',
        platform: 'node', clientId: 'gateway-client', clientMode: 'backend',
        role: 'operator', roles: ['operator'],
        scopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'],
        approvedScopes: ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'],
        tokens: {}, createdAtMs: now, approvedAtMs: now,
      },
    };
  }

  // ── Full OpenClaw Config Generator ────────────────────────────

  private generateOpenClawConfig(
    deployConfig: DeploymentConfig,
    gatewayPort: number,
    gatewayToken: string,
    orgProviders?: AIProvider[],
    orgToolKeys?: { braveApiKey?: string; tavilyApiKey?: string }
  ): OpenClawFullConfig {
    // Resolve primary model: use explicit config, or first available from org providers
    let primaryModel = deployConfig.model || '';
    if (!primaryModel && orgProviders?.length) {
      const firstProvider = orgProviders[0];
      const providerCatalog = PROVIDER_CATALOG[firstProvider.provider as keyof typeof PROVIDER_CATALOG];
      primaryModel = providerCatalog?.models?.[0]?.id || '';
    }
    if (!primaryModel) {
      throw new Error('No AI model configured. Please add an AI provider in settings before deploying.');
    }
    const explicitFallbacks = deployConfig.fallbackModels || [];
    const fallbacks =
      explicitFallbacks.length > 0
        ? explicitFallbacks
        : this.deriveFallbacks(primaryModel, orgProviders);

    // Build model allowlist from primary + fallbacks + all org-provider models
    const { modelsMap, allModels } = this.buildModelCatalog(primaryModel, fallbacks, orgProviders);

    // Build channels config
    const channels = this.buildChannelsConfig(deployConfig.channels || []);

    // Build tools config (pass org's Brave key for web search, NOT platform key)
    const tools = this.buildToolsConfig(deployConfig, orgToolKeys);

    // Build session config
    const session = this.buildSessionConfig(deployConfig);

    // Build skills config
    const skills = this.buildSkillsConfig(deployConfig);

    // Build memory config (pass orgProviders so we can skip the platform embedding key
    // when the user already has their own OpenAI/Gemini/Voyage key in auth-profiles)
    const memorySearch = this.buildMemoryConfig(deployConfig, orgProviders);

    // Build cron config
    const cron: CronConfig = { enabled: true };

    // Build hooks config
    const hooks = this.buildHooksConfig(deployConfig);

    // Build the full OpenClaw config following the official configuration reference.
    // Docs: https://docs.openclaw.ai/gateway/configuration-reference
    const fullConfig: OpenClawFullConfig = {
      // ── Gateway ──────────────────────────────────────────────
      // Multiplexed WS + HTTP on a single port. Auth required by default.
      gateway: {
        mode: 'local',
        port: 18789, // Internal container port (mapped externally via Docker)
        bind: 'lan', // 0.0.0.0 — host (Havoc backend) connects via Docker port-map
        auth: {
          mode: 'token',
          token: gatewayToken,
        },
        // Docker: host=172.x.0.1, container=172.x.0.2. Include container IPs so in-container
        // tools (browser, etc.) connecting via LAN IP get trusted when X-Forwarded-For present.
        // GitHub #4941: Docker NAT causes "pairing required" — extend coverage.
        trustedProxies: [
          '172.17.0.1', '172.17.0.2', '172.18.0.1', '172.18.0.2',
          '172.19.0.1', '172.19.0.2', '172.20.0.1', '172.20.0.2',
          '127.0.0.1',
        ],
        // localNetworks removed: not yet supported by stable OpenClaw (was PR #18441)
        controlUi: {
          enabled: false, // Havoc uses own chat UI; slim build skips Control UI
          allowInsecureAuth: true,
          dangerouslyDisableDeviceAuth: true, // Disable device pairing for managed backend connections
        },
        http: {
          endpoints: {
            chatCompletions: { enabled: deployConfig.apiEnabled ?? true },
            responses: { enabled: deployConfig.responsesApiEnabled ?? false },
          },
        },
      },

      // ── Agents ───────────────────────────────────────────────
      agents: {
        defaults: {
          model: {
            primary: primaryModel,
            fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
          },
          models: modelsMap,
          workspace: '/home/node/.openclaw/workspace',
          maxConcurrent: deployConfig.maxConcurrent ?? 3,
          sandbox: {
            // The agent already runs inside a Docker container — that IS the sandbox.
            // Nested sandboxing (non-main/all) would require Docker-in-Docker which
            // isn't available. Keep 'off' so sub-agents run in the same container process.
            mode: deployConfig.sandboxMode || 'off',
            scope: deployConfig.sandboxScope || 'agent',
            workspaceAccess: deployConfig.sandboxWorkspaceAccess || 'rw',
            docker: { network: deployConfig.sandboxNetwork || 'none' },
            ...(deployConfig.sandboxBrowser ? { browser: { enabled: true } } : {}),
          },
          bootstrapMaxChars: 12000,
          ...(deployConfig.imageModel ? { imageModel: deployConfig.imageModel } : {}),
          // Downscale images before sending to LLM — reduces vision-token cost
          imageMaxDimensionPx: 800,

          // ── Typing indicator ────────────────────────────────
          // Shows "typing..." in channels while the agent is thinking.
          // "thinking" = starts immediately on run start (best for responsiveness).
          typingMode: 'thinking',
          typingIntervalSeconds: 5,

          // ── Human-like pacing ────────────────────────────────
          // Randomized 800–2500ms pause between block replies.
          // Overridden per deployConfig if set explicitly.
          humanDelay: deployConfig.humanDelay && deployConfig.humanDelay !== 'off'
            ? (deployConfig.humanDelay === 'natural'
                ? { mode: 'natural' as const }
                : { mode: 'custom' as const, minMs: deployConfig.humanDelayMin ?? 800, maxMs: deployConfig.humanDelayMax ?? 2500 })
            : { mode: 'natural' as const },

          // ── Block streaming ──────────────────────────────────
          // Emit reply chunks as they arrive (same as ChatGPT streaming feel).
          // Required for non-Telegram channels; Telegram uses draft preview instead.
          blockStreamingDefault: (deployConfig.blockStreaming && deployConfig.blockStreaming !== 'off')
            ? deployConfig.blockStreaming as 'on'
            : 'on',
          blockStreamingBreak: deployConfig.blockStreamingBreak || 'text_end',
          blockStreamingChunk: { minChars: 200, maxChars: 1200 },

          // ── Compaction: safeguard mode ───────────────────────
          // "safeguard" uses chunked summarisation for long task histories —
          // better than "default" for multi-step autonomous workflows.
          // Pre-compaction memory flush reminds the agent to write durable notes
          // before the context window rolls over.
          compaction: {
            mode: 'safeguard',
            reserveTokensFloor: 24000,
            memoryFlush: {
              enabled: true,
              softThresholdTokens: 6000,
              systemPrompt: 'Session nearing compaction. Store durable memories now.',
              prompt: 'Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store.',
            },
          },

          // ── Context pruning ──────────────────────────────────
          // Trims old tool results from in-memory context before each LLM call.
          // Prevents context bloat from browser snapshots, large web_fetch results, etc.
          // Does NOT rewrite on-disk session history.
          contextPruning: {
            mode: 'cache-ttl',
            ttl: '10m',
            keepLastAssistants: 6,
            softTrimRatio: 0.3,
            hardClearRatio: 0.5,
            softTrim: { maxChars: 4000, headChars: 1500, tailChars: 1500 },
            hardClear: { enabled: true, placeholder: '[Old tool result cleared]' },
          },

          // ── Sub-agent defaults ───────────────────────────────
          // Sub-agents (spawned via sessions_spawn) run on a cheaper fast model
          // by default to save cost. Main agent stays on the primary model.
          subagents: {
            model: 'openai/gpt-5-mini',
            archiveAfterMinutes: 60,
          },

          // ── Session memory search ────────────────────────────
          // Enables semantic search over session transcripts in addition to MEMORY.md.
          // Lets the agent recall "what happened last Tuesday" from past sessions.
          ...(memorySearch ? {
            memorySearch: {
              ...memorySearch,
              experimental: { sessionMemory: true },
              sources: ['memory', 'sessions'],
            },
          } : {}),

          // ── Heartbeat ────────────────────────────────────────
          ...(deployConfig.heartbeatEnabled ? {
            heartbeat: {
              every: deployConfig.heartbeatInterval || '30m',
              target: (deployConfig.heartbeatTarget || 'last') as HeartbeatConfig['target'],
              model: deployConfig.heartbeatModel || 'openai/gpt-5-mini',
              ...(deployConfig.heartbeatPrompt ? { prompt: deployConfig.heartbeatPrompt } : {}),
            },
          } : {}),

          // ── Thinking & Reasoning ─────────────────────────────
          ...(deployConfig.thinkingLevel && deployConfig.thinkingLevel !== 'low' ? {
            thinking: {
              level: deployConfig.thinkingLevel,
              ...(deployConfig.reasoningVisibility ? { reasoningVisibility: deployConfig.reasoningVisibility } : {}),
            },
          } : {}),
        },
      },

      // ── Channels ─────────────────────────────────────────────
      // Channels are enabled by their presence in the config.
      channels,

      // ── Web Provider (Baileys / WhatsApp Web) ─────────────────
      // Required when WhatsApp channel is configured. The "web" provider
      // powers WhatsApp Web via Baileys and must be explicitly enabled.
      // Docs: https://docs.openclaw.ai/gateway/configuration-reference#whatsapp
      ...(channels.whatsapp ? {
        web: {
          enabled: true,
          heartbeatSeconds: 60,
          reconnect: {
            initialMs: 2000,
            maxMs: 120000,
            factor: 1.4,
            jitter: 0.2,
            maxAttempts: 0, // 0 = unlimited reconnect attempts
          },
        },
      } : {}),

      // ── Session ──────────────────────────────────────────────
      // Per-channel-peer isolation recommended for multi-user (docs: Session Management)
      session,

      // ── Tools ────────────────────────────────────────────────
      tools,

      // ── Skills ───────────────────────────────────────────────
      skills,

      // ── Cron ─────────────────────────────────────────────────
      cron,

      // ── Hooks (Webhooks + Internal) ──────────────────────────
      hooks: {
        ...(hooks || {}),
        internal: {
          entries: {
            'session-memory': { enabled: true },
          },
        },
      },

      // ── Messages ─────────────────────────────────────────────
      messages: {
        groupChat: {
          mentionPatterns: [`@${deployConfig.name.toLowerCase().replace(/\s+/g, '')}`],
        },
        ...(deployConfig.ttsEnabled ? {
          tts: {
            enabled: true,
            provider: deployConfig.ttsProvider || 'openai',
            ...(deployConfig.ttsVoice ? { voice: deployConfig.ttsVoice } : {}),
          },
        } : {}),
      },

      // ── Wizard State (bypass interactive onboard) ──────────────
      // Inject fake wizard state so OpenClaw believes onboarding has already run.
      // Without this, internal tool calls (sessions_spawn, sessions_list) fall back
      // to external WS connections instead of in-process RPC, causing "pairing required" errors.
      // Pattern borrowed from openclaw-tee (mcclowin/openclaw-tee).
      wizard: {
        lastRunAt: '2026-01-01T00:00:00.000Z',
        lastRunVersion: '2026.2.17',
        lastRunCommand: 'onboard',
        lastRunMode: 'local',
      },

      // ── Commands (root-level, NOT under gateway) ──────────────────
      // Allow in-process restart via gateway tool (config.patch/config.apply trigger this).
      // Docs: https://docs.openclaw.ai/gateway/configuration-reference#commands
      commands: { restart: true },

      // ── Discovery (disable mDNS/Bonjour in Docker) ─────────────
      // Prevents unnecessary network broadcasts inside containers.
      discovery: {
        mdns: { mode: 'off' },
      },

      // ── Logging ────────────────────────────────────────────────
      ...(deployConfig.loggingLevel && deployConfig.loggingLevel !== 'info' ? {
        logging: { level: deployConfig.loggingLevel },
      } : {}),

      // ── Plugins ───────────────────────────────────────────────
      // Channel plugins must be explicitly enabled. Without this, the gateway
      // loads the plugin but marks it as disabled, preventing channel login.
      plugins: {
        load: { paths: [
          '/opt/havoc-knowledge',
          '/opt/havoc-mcp',
          ...((deployConfig.channels || []).some(c => c.type === 'superchat') ? ['/opt/havoc-superchat'] : []),
        ] },
        entries: {
          'havoc-knowledge': { enabled: true },
          ...(channels.whatsapp ? { whatsapp: { enabled: true } } : {}),
          ...(channels.telegram ? { telegram: { enabled: true } } : {}),
          ...(channels.discord ? { discord: { enabled: true } } : {}),
          ...(channels.slack ? { slack: { enabled: true } } : {}),
          ...(channels.signal ? { signal: { enabled: true } } : {}),
          ...((channels as any).bluebubbles ? { bluebubbles: { enabled: true } } : {}),
          ...((channels as any).line ? { line: { enabled: true } } : {}),
          ...((channels as any).googlechat ? { googlechat: { enabled: true } } : {}),
          ...((channels as any).msteams ? { msteams: { enabled: true } } : {}),
          ...((channels as any).mattermost ? { mattermost: { enabled: true } } : {}),
          ...((channels as any).matrix ? { matrix: { enabled: true } } : {}),
          ...((channels as any).feishu ? { feishu: { enabled: true } } : {}),
          // Voice Call plugin
          ...(deployConfig.voiceCallEnabled ? {
            'voice-call': {
              enabled: true,
              config: {
                provider: deployConfig.voiceCallProvider || 'twilio',
                ...(deployConfig.voiceCallProvider === 'twilio' ? {
                  twilio: {
                    accountSid: deployConfig.voiceCallTwilioSid,
                    authToken: deployConfig.voiceCallTwilioToken,
                    from: deployConfig.voiceCallFrom,
                  },
                } : {}),
                ...(deployConfig.voiceCallProvider === 'telnyx' ? {
                  telnyx: { apiKey: deployConfig.voiceCallTwilioSid, from: deployConfig.voiceCallFrom },
                } : {}),
                ...(deployConfig.voiceCallProvider === 'plivo' ? {
                  plivo: { authId: deployConfig.voiceCallTwilioSid, authToken: deployConfig.voiceCallTwilioToken, from: deployConfig.voiceCallFrom },
                } : {}),
                inbound: { policy: deployConfig.voiceCallInboundPolicy || 'notify' },
              },
            },
          } : {}),
          // Lobster workflow engine
          ...(deployConfig.lobsterEnabled ? { lobster: { enabled: true } } : {}),
          // Havoc Superchat proactive send (when Superchat channel connected)
          ...((deployConfig.channels || []).some(c => c.type === 'superchat') ? { 'havoc-superchat': { enabled: true } } : {}),
          // Havoc MCP — Smithery Connect tools (Intercom, Slack, GitHub, Notion, etc.)
          'havoc-mcp': { enabled: true },

        },
      },

      // ── Browser (in-container headless Chromium) ───────────────
      // Chromium is baked into the Docker image. The agent can use the
      // browser tool for web automation (login, form filling, scraping).
      // noSandbox is required because we're already inside a container.
      // Docs: https://docs.openclaw.ai/tools/browser
      ...(deployConfig.browserEnabled ? {
        browser: {
          enabled: true,
          defaultProfile: 'openclaw',
          headless: true,
          noSandbox: true,
          executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        },
      } : {}),
    };

    return fullConfig;
  }

  // ── Channel Config Builder ────────────────────────────────────

  private buildChannelsConfig(channels: ChannelDeployConfig[]): ChannelsConfig {
    // In OpenClaw, a channel is enabled by its presence in the config.
    // WebChat is NOT a channel — it's the built-in Gateway WebSocket UI
    // and works automatically without any config. Do NOT add channels.webchat.
    const config: ChannelsConfig = {};

    for (const ch of channels) {
      const adv = ch.advanced || {};
      switch (ch.type) {
        case 'telegram':
          config.telegram = {
            botToken: ch.credentials?.botToken,
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
            groupPolicy: ch.groupPolicy || 'allowlist',
            groupAllowFrom: ch.groupAllowFrom || [],
            groups: { '*': { requireMention: true } },
            capabilities: ['inlineButtons'],
            // Advanced
            ...(adv.draftChunkMinChars ? { draftChunkMinChars: adv.draftChunkMinChars } : {}),
            ...(adv.draftChunkMaxChars ? { draftChunkMaxChars: adv.draftChunkMaxChars } : {}),
            ...(adv.customCommands?.length ? { customCommands: adv.customCommands } : {}),
            ...(adv.topicsEnabled !== undefined ? { topicsEnabled: adv.topicsEnabled } : {}),
            ...(adv.linkPreview !== undefined ? { linkPreview: adv.linkPreview } : {}),
          };
          break;

        case 'discord':
          config.discord = {
            token: ch.credentials?.botToken,
            dm: {
              enabled: true,
              policy: ch.dmPolicy || 'pairing',
              allowFrom: ch.allowFrom || [],
            },
            guilds: { '*': { requireMention: true } },
            // Advanced
            ...(adv.replyToMode ? { replyToMode: adv.replyToMode } : {}),
            ...(adv.nativeCommands !== undefined ? { nativeCommands: adv.nativeCommands } : {}),
            ...(adv.historyLimit ? { historyLimit: adv.historyLimit } : {}),
            ...(adv.agentComponents !== undefined ? { agentComponents: adv.agentComponents } : {}),
          };
          break;

        case 'slack':
          config.slack = {
            botToken: ch.credentials?.botToken,
            appToken: ch.credentials?.appToken,
            dm: {
              enabled: true,
              policy: ch.dmPolicy || 'pairing',
              allowFrom: ch.allowFrom || [],
            },
            channels: { '*': { requireMention: true } },
            // Advanced
            ...(adv.threadMode ? { threadMode: adv.threadMode } : {}),
            ...(adv.slashCommand ? { slashCommand: adv.slashCommand } : {}),
            ...(adv.userToken ? { userToken: adv.userToken } : {}),
            ...(adv.mode ? { mode: adv.mode } : {}),
          };
          break;

        case 'whatsapp':
          config.whatsapp = {
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
            groupPolicy: ch.groupPolicy || 'allowlist',
            groupAllowFrom: ch.groupAllowFrom || [],
            groups: { '*': { requireMention: true } },
            // Advanced
            ...(adv.textChunkLimit ? { textChunkLimit: adv.textChunkLimit } : {}),
            ...(adv.chunkMode ? { chunkMode: adv.chunkMode } : {}),
            ...(adv.mediaMaxMb ? { mediaMaxMb: adv.mediaMaxMb } : {}),
            ...(adv.sendReadReceipts !== undefined ? { sendReadReceipts: adv.sendReadReceipts } : {}),
            ...(adv.ackReaction ? { ackReaction: adv.ackReaction } : {}),
            ...(adv.multiAccount !== undefined ? { multiAccount: adv.multiAccount } : {}),
          };
          break;

        case 'signal':
          config.signal = {
            phoneNumber: ch.credentials?.phoneNumber,
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
          };
          break;

        case 'bluebubbles':
          config.bluebubbles = {
            bridgeUrl: ch.credentials?.bridgeUrl,
            bridgePassword: ch.credentials?.bridgePassword,
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
          };
          break;

        case 'imessage':
          config.imessage = {
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
            groupPolicy: ch.groupPolicy || 'allowlist',
            groupAllowFrom: ch.groupAllowFrom || [],
          };
          break;

        case 'line':
          config.line = {
            channelAccessToken: ch.credentials?.channelAccessToken,
            channelSecret: ch.credentials?.channelSecret,
            dmPolicy: ch.dmPolicy || 'pairing',
            allowFrom: ch.allowFrom || [],
          };
          break;

        case 'googlechat':
          config.googlechat = {
            serviceAccountKey: ch.credentials?.serviceAccountKey,
            dmPolicy: ch.dmPolicy || 'pairing',
          };
          break;

        case 'msteams':
          config.msteams = {
            appId: ch.credentials?.appId,
            appSecret: ch.credentials?.appPassword,
            dmPolicy: ch.dmPolicy || 'pairing',
          };
          break;

        case 'mattermost':
          config.mattermost = {
            url: ch.credentials?.url,
            botToken: ch.credentials?.botToken,
            dmPolicy: ch.dmPolicy || 'pairing',
          };
          break;

        case 'matrix':
          config.matrix = {
            homeserverUrl: ch.credentials?.homeserverUrl,
            accessToken: ch.credentials?.accessToken,
            userId: ch.credentials?.userId,
            dmPolicy: ch.dmPolicy || 'pairing',
          };
          break;

        case 'feishu':
          config.feishu = {
            appId: ch.credentials?.feishuAppId,
            appSecret: ch.credentials?.feishuAppSecret,
            dmPolicy: ch.dmPolicy || 'pairing',
          };
          break;

        case 'webchat':
          // WebChat is NOT an OpenClaw channel — it's the built-in Gateway
          // WebSocket UI. No config entry needed; it works automatically.
          break;
      }
    }

    return config;
  }

  // ── Tools Config Builder ──────────────────────────────────────

  private buildToolsConfig(
    deployConfig: DeploymentConfig,
    orgToolKeys?: { braveApiKey?: string; tavilyApiKey?: string }
  ): ToolsConfig {
    // Strategy: Use 'full' profile for ALL agents (unrestricted base), then apply
    // use-case-specific deny lists to remove dangerous tools.
    // This ensures every agent has: group:fs, group:memory, group:sessions, web_search,
    // web_fetch, gateway (self-config), cron, message. Deny list is empty — container is the sandbox.
    //
    // The old 'messaging' profile was too restrictive: no group:fs, no group:memory,
    // no web_search — agents couldn't create memory files, read their workspace,
    // or search the web. That's not functional for any real use case.
    //
    // Security is enforced via deny lists, NOT via restrictive profiles.
    // deny always wins over allow.

    const useCase = deployConfig.useCase || 'general';

    // Use-case-aware deny lists (safety defaults for non-technical agents)
    const defaultDeny = this.resolveToolDeny(useCase);

    // Web search: prefer ORG's Brave API key, fall back to platform key.
    // Platform key provides baseline web search for all agents (metered per-org via usage tracking).
    const orgBraveKey = orgToolKeys?.braveApiKey;
    const searchApiKey = orgBraveKey || config.braveApiKey || undefined;

    const tools: ToolsConfig = {
      profile: deployConfig.toolProfile || 'full',
      allow: deployConfig.toolAllow || this.computeSkillAllowList(deployConfig),
      deny: (deployConfig.toolDeny || defaultDeny).filter(
        // If browser is explicitly enabled, remove it from deny list
        t => !(deployConfig.browserEnabled && t === 'browser')
      ),
      // With profile 'full', all built-in tools are available. alsoAllow adds plugin/dynamic tools.
      alsoAllow: [
        'wallet',
        'knowledge_search',
        'mcp_list',
        'mcp_call',
        ...(deployConfig.lobsterEnabled ? ['lobster'] : []),
        ...((deployConfig.channels || []).some(c => c.type === 'superchat') ? ['superchat'] : []),
        ...(deployConfig.toolAlsoAllow || []),
      ],
      elevated: {
        enabled: false, // Never allow elevated exec in managed deployments
      },
      // Exec: container IS the sandbox — no approvals needed inside it
      exec: {
        security: 'full',
        ask: 'off',
      },
      web: {
        search: {
          enabled: !!searchApiKey,
          ...(searchApiKey ? { apiKey: searchApiKey } : {}),
          maxResults: 5,
        },
        fetch: {
          enabled: true,
        },
      },
      // Loop detection: verhindert Agent-Endlosschleifen bei autonomen Workflows
      loopDetection: { enabled: true },
      // ── Media understanding (image/audio/video) ──────────────────
      // Transcribes voice messages, describes images, summarizes videos
      // before the agent sees them. Uses the org's configured providers.
      media: {
        concurrency: 2,
        models: [
          { provider: 'google', model: 'gemini-3-flash-preview', capabilities: ['image', 'audio', 'video'] },
          { provider: 'openai', model: 'gpt-4o-mini-transcribe', capabilities: ['audio'] },
          { provider: 'openai', model: 'gpt-4o-mini', capabilities: ['image'] },
        ],
        audio: {
          enabled: true,
          maxBytes: 20_971_520,
          echoTranscript: true,
          echoFormat: '📝 "{transcript}"',
        },
        image: {
          enabled: true,
          maxBytes: 10_485_760,
        },
        video: {
          enabled: true,
          maxBytes: 52_428_800,
        },
      },
    };

    return tools;
  }

  /** Deny list: empty — agents can use gateway for self-config (browser, model, thinking).
   *  The Docker container is the security sandbox; gateway only affects that container. */
  private resolveToolDeny(_useCase: string): string[] {
    return [];
  }

  /** Compute effective tool allow list from installed skills' permissions.
   *  Returns union of all skills' permissions. If ANY skill has no permissions
   *  (unrestricted), returns [] (= allow all, backward compat). */
  private computeSkillAllowList(deployConfig: DeploymentConfig): string[] {
    const sp = deployConfig.skillPermissions;
    if (!sp || Object.keys(sp).length === 0) return [];
    const enabledSkills = deployConfig.skills || [];
    const allPerms = new Set<string>();
    for (const slug of enabledSkills) {
      const perms = sp[slug];
      if (!perms || perms.length === 0) return []; // unrestricted skill → allow all
      for (const p of perms) allPerms.add(p);
    }
    // Always include core tools agents need regardless of skills
    allPerms.add('group:memory');
    allPerms.add('group:sessions');
    allPerms.add('message');
    return [...allPerms];
  }

  // ── Session Config Builder ────────────────────────────────────

  private buildSessionConfig(deployConfig: DeploymentConfig): SessionConfig {
    const sc = deployConfig.sessionConfig;

    // Docs: https://docs.openclaw.ai/gateway/configuration-reference#session
    // dmScope: "per-channel-peer" recommended for multi-user inboxes (prevents cross-user context leakage)
    // reset: daily at 4 AM + idle after 120 min, whichever expires first wins
    return {
      scope: sc?.scope || 'per-sender',
      dmScope: sc?.dmScope || 'per-channel-peer',
      ...(sc?.mainKey ? { mainKey: sc.mainKey } : {}),
      ...(sc?.identityLinks && Object.keys(sc.identityLinks).length > 0 ? { identityLinks: sc.identityLinks } : {}),
      reset: {
        mode: sc?.resetMode || 'daily',
        atHour: sc?.atHour ?? 4,
        idleMinutes: sc?.idleMinutes ?? 120,
      },
      ...(sc?.resetByType ? { resetByType: sc.resetByType } : {}),
      resetTriggers: sc?.resetTriggers || ['/new', '/reset'],
    };
  }

  // ── Skills Config Builder ─────────────────────────────────────

  /** Skill slugs known to not exist in ClawHub — filter to avoid gateway "Skill not found" log spam */
  private static readonly INVALID_SKILL_SLUGS = new Set(['firecrawl-skills', 'core-pa-admin-exec-support']);

  /** Core skills installed for every agent (native capabilities) */
  private static readonly CORE_SKILLS: string[] = [
    // sponge-wallet removed — replaced by native havoc-wallet plugin
  ];

  private buildSkillsConfig(deployConfig: DeploymentConfig): SkillsConfig {
    const entries: Record<string, { enabled: boolean }> = {};

    // Always include core/native skills
    for (const slug of DeploymentService.CORE_SKILLS) {
      entries[slug] = { enabled: true };
    }

    for (const skill of (deployConfig.skills || [])) {
      if (DeploymentService.INVALID_SKILL_SLUGS.has(skill)) continue;
      entries[skill] = { enabled: true };
    }

    return {
      load: {
        watch: true,
        watchDebounceMs: 250,
      },
      install: {
        nodeManager: 'npm',
      },
      entries,
    };
  }

  // ── Memory Config Builder ─────────────────────────────────────

  private buildMemoryConfig(deployConfig: DeploymentConfig, orgProviders?: AIProvider[]): MemorySearchConfig | undefined {
    const mc = deployConfig.memoryConfig;
    if (mc?.provider === 'none') return undefined;

    // NEVER use 'local' in Docker — it requires node-llama-cpp native compilation
    // + a 600MB GGUF model download, which blocks gateway startup for 5-10 minutes
    // and fails if build tools (cmake/g++) were removed from the image.
    const userProvider = mc?.provider === 'local' ? undefined : mc?.provider;

    // Check if the user's org already has an embedding-capable provider key
    // (OpenAI, Google/Gemini, or Voyage). If so, OpenClaw auto-detects
    // from auth-profiles.json and we don't need to inject a platform key.
    const embeddingProviders = ['openai', 'google', 'voyage'];
    const hasOwnEmbeddingKey = orgProviders?.some(
      p => embeddingProviders.includes(p.provider) && p.status === 'active'
    ) ?? false;

    if (userProvider) {
      const needsPlatformKey = !hasOwnEmbeddingKey && config.geminiApiKey;
      return {
        provider: userProvider,
        sync: { watch: true },
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
        ...(needsPlatformKey && userProvider === 'gemini' ? {
          remote: { apiKey: config.geminiApiKey },
        } : {}),
      };
    }

    // User has own embedding-capable key → let OpenClaw auto-detect from auth-profiles.
    if (hasOwnEmbeddingKey) {
      return {
        sync: { watch: true },
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
      };
    }

    // Platform Gemini key available → use as primary embedding provider.
    if (config.geminiApiKey) {
      return {
        provider: 'gemini',
        sync: { watch: true },
        sources: ['memory', 'sessions'],
        experimental: { sessionMemory: true },
        remote: { apiKey: config.geminiApiKey },
      };
    }

    // No embedding key available at all → disable memory search entirely.
    // A broken config (enabled but no provider) is worse than no config.
    return undefined;
  }

  // ── Hooks Config Builder ──────────────────────────────────────

  private buildHooksConfig(deployConfig: DeploymentConfig): HooksConfig | undefined {
    const wc = deployConfig.webhookConfig;
    if (!wc?.enabled) return undefined;

    return {
      enabled: true,
      token: wc.token || this.generateToken(),
      path: '/hooks',
      mappings: wc.mappings || [],
      defaultSessionKey: 'hook:ingress',
      allowRequestSessionKey: false,
      allowedSessionKeyPrefixes: ['hook:'],
    };
  }

  // ── Model Catalog Builder ────────────────────────────────────

  /**
   * Well-known model aliases for /model quick-switch.
   * Aligned with OpenClaw built-in shorthands where possible:
   * opus, sonnet, gpt, gpt-mini, gemini, gemini-flash
   */
  private static MODEL_ALIASES: Record<string, string> = {
    'anthropic/claude-opus-4-6': 'opus',
    'anthropic/claude-sonnet-4-6': 'sonnet',
    'openai/gpt-5-mini': 'gpt-mini',
    'openai/gpt-5.2': 'gpt',
    'openai/o3': 'o3',
    'openai/o4-mini': 'o4-mini',
    'google/gemini-3-flash-preview': 'gemini-flash',
    'google/gemini-3-pro-preview': 'gemini',
  };

  /** Known model catalogs per provider type (OpenClaw identifiers) */
  private static PROVIDER_MODELS: Record<string, string[]> = {
    anthropic: [
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-opus-4-6',
    ],
    openai: [
      'openai/gpt-5-mini',
      'openai/gpt-5.2',
      'openai/o3',
      'openai/o4-mini',
    ],
    google: [
      'google/gemini-3-flash-preview',
      'google/gemini-3-pro-preview',
    ],
    xai: ['xai/grok-3', 'xai/grok-4'],
    mistral: ['mistral/mistral-small', 'mistral/mistral-large'],
    groq: [
      'groq/llama-4-scout-17b-16e-instruct',
      'groq/llama-3.3-70b-versatile',
    ],
    openrouter: [
      // OpenRouter proxies all models — agent uses the primary model ID
    ],
  };

  /** Suggested fallback order by tier (fast first for resilience, then balanced, premium last) */
  private static FALLBACK_ORDER: Array<{ provider: string; model: string; tier: string }> = [
    { provider: 'openai', model: 'openai/gpt-5-mini', tier: 'fast' },
    { provider: 'google', model: 'google/gemini-3-flash-preview', tier: 'fast' },
    { provider: 'anthropic', model: 'anthropic/claude-sonnet-4-6', tier: 'balanced' },
    { provider: 'openai', model: 'openai/gpt-5.2', tier: 'balanced' },
    { provider: 'openai', model: 'openai/o4-mini', tier: 'balanced' },
    { provider: 'xai', model: 'xai/grok-3', tier: 'balanced' },
    { provider: 'groq', model: 'groq/llama-3.3-70b-versatile', tier: 'balanced' },
    { provider: 'mistral', model: 'mistral/mistral-small', tier: 'fast' },
  ];

  /**
   * Derive fallback models from org providers when not explicitly set.
   * Picks up to 4 models from other providers in a resilience-optimized order
   * (fast models first for failover speed).
   */
  private deriveFallbacks(primaryModel: string, orgProviders?: AIProvider[]): string[] {
    if (!orgProviders || orgProviders.length === 0) return [];
    const primaryProvider = primaryModel.split('/')[0];
    const available = new Set<string>();
    for (const p of orgProviders) {
      const models = p.availableModels?.length
        ? p.availableModels
        : DeploymentService.PROVIDER_MODELS[p.provider] ?? [];
      for (const m of models) available.add(m);
    }
    available.delete(primaryModel);
    const result: string[] = [];
    for (const entry of DeploymentService.FALLBACK_ORDER) {
      if (result.length >= 4) break;
      if (entry.provider === primaryProvider) continue;
      if (available.has(entry.model) && !result.includes(entry.model)) {
        result.push(entry.model);
      }
    }
    return result;
  }

  /**
   * Build the full model catalog for agents.defaults.models.
   * Combines primary + fallback models with all models available from
   * the organization's configured AI providers.
   */
  private buildModelCatalog(
    primaryModel: string,
    fallbacks: string[],
    orgProviders?: AIProvider[]
  ): { modelsMap: Record<string, { alias?: string }>; allModels: string[] } {
    const modelsMap: Record<string, { alias?: string }> = {};
    const seenModels = new Set<string>();

    // Helper: add model with alias
    const addModel = (modelId: string) => {
      if (seenModels.has(modelId)) return;
      seenModels.add(modelId);
      const alias = DeploymentService.MODEL_ALIASES[modelId];
      const entry: Record<string, unknown> = alias ? { alias } : {};
      // Enable prompt caching for Anthropic models (cache reads are 90% cheaper)
      if (modelId.startsWith('anthropic/')) {
        entry.params = { cacheRetention: 'short' };
      }
      modelsMap[modelId] = entry as { alias?: string };
    };

    // 1. Always include primary + fallbacks
    addModel(primaryModel);
    for (const fb of fallbacks) addModel(fb);

    // 2. Add all models from org providers
    if (orgProviders && orgProviders.length > 0) {
      for (const provider of orgProviders) {
        const knownModels = DeploymentService.PROVIDER_MODELS[provider.provider];
        if (knownModels) {
          for (const m of knownModels) addModel(m);
        }
        // Also add any models stored on the provider record itself
        if (provider.availableModels && Array.isArray(provider.availableModels)) {
          for (const m of provider.availableModels) addModel(m);
        }
      }
    }

    return { modelsMap, allModels: Array.from(seenModels) };
  }

  // ── Auth Profiles Builder ────────────────────────────────────

  /**
   * Build OpenClaw auth-profiles.json from organization providers.
   * This is the native way OpenClaw handles AI provider credentials.
   * Docs: https://docs.openclaw.ai/getting-started/auth-profiles
   */
  private buildAuthProfiles(orgProviders?: AIProvider[]): Record<string, any> {
    // OpenClaw auth-profiles.json uses a "profiles" object with entries like:
    //   { "profiles": { "anthropic:default": { "type": "api_key", "provider": "anthropic", "key": "sk-..." } } }
    // Docs: https://docs.openclaw.ai/concepts/model-failover
    const profiles: Record<string, any> = {};

    if (!orgProviders || orgProviders.length === 0) {
      // No org providers → use platform Anthropic key as "Havoc AI" fallback.
      if (config.anthropicApiKey) {
        profiles['anthropic:default'] = {
          type: 'api_key',
          provider: 'anthropic',
          key: config.anthropicApiKey,
        };
      }
      return { profiles };
    }

    for (const provider of orgProviders) {
      try {
        const key = decrypt(provider.apiKeyEncrypted);
        const profileId = `${provider.provider}:default`;

        profiles[profileId] = {
          type: 'api_key',
          provider: provider.provider,
          key,
        };
      } catch (err) {
        console.warn(`[deploy] Failed to decrypt key for provider ${provider.provider}:`, err);
      }
    }

    return { profiles };
  }

  // ── Workspace Creation ────────────────────────────────────────

  private async createWorkspace(
    agentId: string,
    openclawConfig: OpenClawFullConfig,
    deployConfig: DeploymentConfig,
    orgProviders?: AIProvider[],
  ): Promise<string> {
    const basePath = join(this.workspaceDir, agentId);
    const workspacePath = join(basePath, 'workspace');
    const credentialsPath = join(basePath, 'credentials');
    const agentsPath = join(basePath, 'agents', 'main', 'agent');
    const skillsPath = join(workspacePath, 'skills');
    const memoryPath = join(workspacePath, 'memory');

    // Create directory structure
    await mkdir(basePath, { recursive: true });
    await mkdir(workspacePath, { recursive: true });
    await mkdir(credentialsPath, { recursive: true });
    await mkdir(agentsPath, { recursive: true });
    await mkdir(skillsPath, { recursive: true });
    await mkdir(memoryPath, { recursive: true });

    // Write openclaw.json (strip nulls — OpenClaw rejects null values in config)
    await writeFile(
      join(basePath, 'openclaw.json'),
      JSON.stringify(stripNulls(openclawConfig), null, 2)
    );

    // Write auth-profiles.json — OpenClaw's native auth profile system.
    // This is where AI provider API keys live (NOT as container env vars).
    // OpenClaw looks for auth-profiles.json in the per-agent directory:
    //   ~/.openclaw/agents/main/agent/auth-profiles.json
    // Docs: https://docs.openclaw.ai/getting-started/auth-profiles
    const authProfiles = this.buildAuthProfiles(orgProviders);
    await writeFile(
      join(agentsPath, 'auth-profiles.json'),
      JSON.stringify(authProfiles, null, 2)
    );
    // Also write to root for backwards compatibility with older OpenClaw versions
    await writeFile(
      join(basePath, 'auth-profiles.json'),
      JSON.stringify(authProfiles, null, 2)
    );

    // Generate and write workspace template files
    const cfgTools = openclawConfig.tools;
    const cfgModel = openclawConfig.agents?.defaults?.model?.primary || 'anthropic/claude-sonnet-4-6';
    const templateData: WorkspaceTemplateData = {
      agentName: deployConfig.name,
      agentDescription: deployConfig.description,
      systemPrompt: deployConfig.systemPrompt || 'You are a helpful AI assistant.',
      soulPrompt: deployConfig.soulPrompt,
      identityName: deployConfig.identityName,
      useCase: (deployConfig as any).useCase,
      channels: (deployConfig.channels || []).map(c => c.type),
      skills: deployConfig.skills,
      organizationName: (deployConfig as any).organizationName,
      userName: (deployConfig as any).userName,
      availableTools: {
        webSearch: !!(cfgTools as any)?.web?.search?.enabled,
        webFetch: true,
        browser: !!deployConfig.browserEnabled,
        message: true,
        exec: true,
        gateway: true,
        cron: true,
        memory: true,
        fileSystem: true,
        superchatSend: (deployConfig.channels || []).some(c => c.type === 'superchat'),
      },
      primaryModel: cfgModel,
      lobsterEnabled: !!deployConfig.lobsterEnabled,
      heartbeatTasks: deployConfig.heartbeatTasks,
    };

    const workspaceFiles = generateWorkspaceFiles(templateData);
    for (const [filename, content] of Object.entries(workspaceFiles)) {
      await writeFile(join(workspacePath, filename), content);
    }

    // ── Pre-seed paired.json so the container starts already paired ─────
    // Derives the same deterministic Ed25519 keypair that GatewayWsClient uses,
    // so the backend can connect immediately without a pairing dance.
    const gwToken = openclawConfig.gateway?.auth?.token;
    if (gwToken) {
      const devicesPath = join(basePath, 'devices');
      await mkdir(devicesPath, { recursive: true });
      const paired = this.buildPairedJson(agentId, gwToken);
      await writeFile(join(devicesPath, 'paired.json'), JSON.stringify(paired, null, 2));
    }

    // ── Fix permissions for container = backend user ─────────────────────
    // Container runs as backend uid:gid (User override in docker.service).
    // Workspace must be owned by backend so both backend and container can read/write.
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
    const basePathQuoted = JSON.stringify(basePath);
    try {
      try {
        execSync(`chown -R ${uid}:${gid} ${basePathQuoted}`, { timeout: 10000, stdio: 'pipe' });
      } catch {
        execSync(`sudo -n chown -R ${uid}:${gid} ${basePathQuoted}`, { timeout: 10000, stdio: 'pipe' });
      }
      try {
        execSync(`chmod -R 770 ${basePathQuoted}`, { timeout: 10000, stdio: 'pipe' });
      } catch {
        execSync(`chmod -R 755 ${basePathQuoted}`, { timeout: 10000, stdio: 'pipe' });
      }
    } catch (err) {
      console.warn(`[deploy] Could not fix workspace permissions for ${basePath}:`, err instanceof Error ? err.message : err);
      // Non-fatal: workspace is usable if backend user matches container
    }

    // ── Verify workspace integrity before returning ──────────
    const configFile = join(basePath, 'openclaw.json');
    try {
      await stat(configFile);
    } catch {
      throw new Error(`Workspace integrity check failed: ${configFile} missing after createWorkspace`);
    }

    return basePath;
  }

  // ── Deploy Agent ──────────────────────────────────────────────

  async deployAgent(deployConfig: DeploymentConfig): Promise<DeploymentResult> {
    let gatewayPort: number | null = null;
    let retryCount = 0;
    const maxRetries = 1;

    while (retryCount <= maxRetries) {
      try {
        gatewayPort = await this.getAvailablePort();
        const gatewayToken = this.generateToken();

        // ── Fetch organization data ────────────────────────────────
        // All API keys are org-owned. Platform .env keys are NEVER passed
        // to agent containers — orgs pay for their own AI + tool usage.
        let orgProviders: AIProvider[] = [];
        let orgToolKeys: { braveApiKey?: string; tavilyApiKey?: string } = {};

        if (deployConfig.organizationId) {
          const db = getDatabase();

          // AI model provider keys → auth-profiles.json
          orgProviders = await db.collection<AIProvider>('providers')
            .find({
              organizationId: deployConfig.organizationId,
              status: 'active',
            })
            .toArray();

          // Tool API keys (Brave Search, Tavily) → openclaw.json tools.web section
          const org = await db.collection('organizations').findOne({
            clerkId: deployConfig.organizationId,
          });
          if (org?.toolApiKeys) {
            if (org.toolApiKeys.braveApiKeyEncrypted) {
              try { orgToolKeys.braveApiKey = decrypt(org.toolApiKeys.braveApiKeyEncrypted); } catch (err) { console.warn('[deploy] Failed to decrypt Brave API key:', (err as Error).message); }
            }
            if (org.toolApiKeys.tavilyApiKeyEncrypted) {
              try { orgToolKeys.tavilyApiKey = decrypt(org.toolApiKeys.tavilyApiKeyEncrypted); } catch (err) { console.warn('[deploy] Failed to decrypt Tavily API key:', (err as Error).message); }
            }
          }
        }

        // Generate full OpenClaw config (org providers for models + tool keys for web search)
        // Fetch installed skill permissions for least-privilege tool policy
        if (deployConfig.skills?.length && deployConfig.organizationId) {
          const db = getDatabase();
          const installed = await db.collection('agent_skills')
            .find({ agentId: deployConfig.agentId, enabled: true })
            .project({ slug: 1, permissions: 1 })
            .toArray();
          const perms: Record<string, string[]> = {};
          for (const s of installed) {
            if (s.permissions?.length) perms[s.slug] = s.permissions;
          }
          if (Object.keys(perms).length > 0) deployConfig.skillPermissions = perms;
        }

        const openclawConfig = this.generateOpenClawConfig(deployConfig, gatewayPort, gatewayToken, orgProviders, orgToolKeys);

        // Create workspace with templates + auth-profiles
        const workspacePath = await this.createWorkspace(
          deployConfig.agentId,
          openclawConfig,
          deployConfig,
          orgProviders
        );

        const containerName = `openclaw-${deployConfig.agentId}`;

        // Build env vars for the container — only gateway operational vars.
        // API keys are in auth-profiles.json + openclaw.json, NOT env vars.
        const env: Record<string, string> = {
          OPENCLAW_GATEWAY_TOKEN: gatewayToken,
          HAVOC_AGENT_ID: deployConfig.agentId,
          HAVOC_BACKEND_URL: config.havocBackendUrl,
        };

        // Create container using Docker SDK.
        // Mount the FULL basePath (contains openclaw.json, workspace/, agents/, credentials/)
        // into /home/node/.openclaw so OpenClaw can find its config.
        const containerId = await dockerService.createContainer({
          name: containerName,
          image: config.openclawImageTag,
          workspacePath: workspacePath,  // basePath that contains openclaw.json
          gatewayPort,
          agentId: deployConfig.agentId,
          env,
        });

        // Wait for container to be healthy.
        // Probes the Gateway WebSocket with the auth token.
        await dockerService.waitForHealthy(containerId, gatewayPort, gatewayToken);

        const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;

        console.log(`Deployed OpenClaw agent: ${deployConfig.name}`);
        console.log(`  Container: ${containerId}`);
        console.log(`  Gateway: ${gatewayUrl}`);
        console.log(`  Channels: ${(deployConfig.channels || []).map(c => c.type).join(', ') || 'webchat'}`);

        // Port is now persisted in DB via the caller — release reservation
        this.releasePort(gatewayPort);

        return {
          containerId,
          gatewayPort,
          gatewayUrl,
          gatewayToken,
        };
      } catch (error) {
        // Release port reservation on failure
        if (gatewayPort !== null) {
          this.releasePort(gatewayPort);
        }

        // Check if this is a port conflict error and we can retry
        const isPortConflict = error instanceof Error && 
          (error.message.includes('port') || error.message.includes('bind') || error.message.includes('address already in use'));
        
        if (isPortConflict && retryCount < maxRetries) {
          retryCount++;
          console.warn(`[deploy] Port conflict detected, retrying (${retryCount}/${maxRetries}):`, error instanceof Error ? error.message : error);
          continue;
        }

        console.error('Deployment failed:', error);
        throw new Error(`Deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    throw new Error('Deployment failed after all retries');
  }

  // ── Update Agent Config (Hot Reload) ──────────────────────────

  async updateAgentConfig(
    agentId: string,
    updates: Partial<OpenClawFullConfig>
  ): Promise<void> {
    const basePath = join(this.workspaceDir, agentId);
    const configPath = join(basePath, 'openclaw.json');

    // Read current config
    const { readFile } = await import('fs/promises');
    const currentRaw = await readFile(configPath, 'utf-8');
    const currentConfig = JSON.parse(currentRaw) as OpenClawFullConfig;

    // Deep merge updates, then strip null values (OpenClaw rejects null in config)
    const merged = stripNulls(deepMerge(currentConfig, updates));
    const mergedRaw = JSON.stringify(merged, null, 2);

    // Write updated config to filesystem
    await writeFile(configPath, mergedRaw);

    // Hot-reload via Gateway WS config.patch (instant, no file-watch delay)
    // Skip patch during active WhatsApp QR login — config.patch triggers gateway restart and wipes login state.
    // Falls back silently to FS-only if gateway is not connected.
    try {
      const { gatewayManager } = await import('./gateway-ws.service.js');
      if (gatewayManager.hasActiveChannelLogin(agentId)) {
        console.log(`[deploy] Skipping config.patch for agent ${agentId} — active channel login in progress`);
        return;
      }
      const client = gatewayManager.getClient(agentId);
      if (client?.isConnected()) {
        // Get the current config hash for optimistic concurrency
        const { hash } = await client.configGet();
        // Send only the partial updates, not the full merged config
        const updatesRaw = JSON.stringify(updates, null, 2);
        await client.configPatch(updatesRaw, hash, { restartDelayMs: 500 });
        console.log(`[deploy] Config hot-reloaded via WS for agent ${agentId}`);
      }
    } catch (wsError) {
      // Non-fatal: FS write succeeded, OpenClaw's file watcher will pick it up
      console.warn(`[deploy] WS config.patch failed for agent ${agentId} (FS write OK):`, wsError);
    }
  }

  // ── Container Lifecycle ───────────────────────────────────────

  async stopAgent(containerId: string): Promise<void> {
    await dockerService.stopContainer(containerId);
  }

  async startAgent(containerId: string): Promise<void> {
    await dockerService.startContainer(containerId);
  }

  async restartAgent(containerId: string): Promise<void> {
    await dockerService.stopContainer(containerId);
    await dockerService.startContainer(containerId);
  }

  /** Destroy the old container and create a fresh one with the current image.
   *  Preserves the existing workspace, port, and gateway token so the agent
   *  keeps its config, memory, and sessions across redeploys. */
  async redeployAgent(
    agentId: string,
    oldContainerId: string,
    gatewayPort: number,
    gatewayToken: string
  ): Promise<string> {
    await dockerService.deleteContainer(oldContainerId);

    // Regenerate config with latest settings
    const db = getDatabase();
    const agent = await db.collection('agents').findOne({ _id: new ObjectId(agentId) });
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const agentConfigPath = join(this.workspaceDir, agentId, 'agent', 'openclaw.json');
    
    // Fetch org providers for model config
    const orgProviders = agent.organizationId
      ? await db.collection('providers').find({ organizationId: agent.organizationId }).toArray()
      : [];

    // Regenerate full OpenClaw config
    const openclawConfig = this.generateOpenClawConfig(
      {
        agentId,
        userId: agent.userId,
        organizationId: agent.organizationId,
        name: agent.name,
        description: agent.description || '',
        model: agent.config.model,
        systemPrompt: agent.config.systemPrompt,
        skills: agent.config.skills || [],
        channels: agent.channels?.map((c: any) => ({ type: c.type })) || [],
        useCase: agent.useCase || 'general',
        browserEnabled: agent.config.browserEnabled ?? true,
        heartbeatEnabled: agent.config.heartbeatEnabled ?? true,
        lobsterEnabled: agent.config.lobsterEnabled ?? true,
      },
      gatewayPort,
      gatewayToken,
      orgProviders as any[]
    );

    await writeFile(agentConfigPath, JSON.stringify(openclawConfig, null, 2), 'utf-8');
    console.log(`[redeploy] Regenerated config for agent ${agentId}`);

    const containerName = `openclaw-${agentId}`;
    const workspacePath = join(this.workspaceDir, agentId);

    const env: Record<string, string> = {
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      HAVOC_AGENT_ID: agentId,
      HAVOC_BACKEND_URL: config.havocBackendUrl,
    };

    const newContainerId = await dockerService.createContainer({
      name: containerName,
      image: config.openclawImageTag,
      workspacePath,
      gatewayPort,
      agentId,
      env,
    });

    // Pre-seed paired.json (same logic as initial deploy)
    const devicesPath = join(workspacePath, 'devices');
    await mkdir(devicesPath, { recursive: true });
    await writeFile(join(devicesPath, 'paired.json'), JSON.stringify(
      this.buildPairedJson(agentId, gatewayToken), null, 2));

    await dockerService.waitForHealthy(newContainerId, gatewayPort, gatewayToken);

    console.log(`[redeploy] Agent ${agentId} redeployed with image ${config.openclawImageTag}`);
    return newContainerId;
  }

  async deleteAgent(containerId: string): Promise<void> {
    await dockerService.deleteContainer(containerId);
  }

  async getContainerStatus(containerId: string): Promise<'running' | 'stopped' | 'error'> {
    return dockerService.getContainerStatus(containerId);
  }

  /** Recover agent stuck on "deploying" when container exists but DB was never updated. */
  async recoverDeployingAgent(agentId: string): Promise<{ containerId: string; gatewayPort: number; gatewayToken: string } | null> {
    const found = await dockerService.findContainerByAgentId(agentId);
    if (!found) return null;

    const containerStatus = await dockerService.getContainerStatus(found.id);
    if (containerStatus !== 'running') return null;

    const basePath = join(this.workspaceDir, agentId);
    const configPath = join(basePath, 'openclaw.json');
    try {
      const { readFile } = await import('fs/promises');
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { gateway?: { auth?: { token?: string } } };
      const token = parsed?.gateway?.auth?.token;
      if (!token) return null;

      return {
        containerId: found.id,
        gatewayPort: found.port,
        gatewayToken: token,
      };
    } catch {
      return null;
    }
  }

  async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
    return dockerService.getContainerLogs(containerId, lines);
  }

  async getContainerStats(containerId: string) {
    return dockerService.getContainerStats(containerId);
  }
}

// ── Utility: Deep Merge ─────────────────────────────────────────

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      (result as any)[key] = deepMerge(targetVal as any, sourceVal as any);
    } else if (sourceVal !== undefined) {
      (result as any)[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Recursively remove null values from an object.
 * OpenClaw's config validator rejects null (expects string | undefined).
 */
function stripNulls(obj: any): any {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== null && val !== undefined) {
        cleaned[key] = stripNulls(val);
      }
    }
    return cleaned;
  }
  return obj;
}

export const deploymentService = new DeploymentService();
