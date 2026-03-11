// Channel Service - Manages OpenClaw channel connections per agent
// Handles credential storage, config generation, and container hot-reload

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { deploymentService } from './deployment.service.js';
import { validateChannelCredentials } from './security.service.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import type {
  ChannelType,
  DmPolicy,
  GroupPolicy,
  ChannelDeployConfig,
  ChannelsConfig,
} from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface AgentChannel {
  agentId: string;
  userId: string;
  type: ChannelType;
  status: 'connected' | 'disconnected' | 'pending' | 'error';
  config: {
    dmPolicy?: DmPolicy;
    allowFrom?: string[];
    groupPolicy?: GroupPolicy;
    groupAllowFrom?: string[];
  };
  credentials: {
    encrypted: string;
  };
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddChannelRequest {
  type: ChannelType;
  credentials?: {
    botToken?: string;
    appToken?: string;
    phoneNumber?: string;
    bridgeUrl?: string;
    bridgePassword?: string;
    serviceAccountKey?: string;
    appId?: string;
    appSecret?: string;
    tenantId?: string;
    url?: string;
    token?: string;
    homeserverUrl?: string;
    accessToken?: string;
    userId?: string;
    channelAccessToken?: string;
    channelSecret?: string;
    apiKey?: string;  // Superchat
    [key: string]: string | undefined;  // Allow additional fields
  };
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  groupPolicy?: GroupPolicy;
  groupAllowFrom?: string[];
}

export interface ChannelStatusResponse {
  type: ChannelType;
  status: 'connected' | 'disconnected' | 'pending' | 'error';
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  errorMessage?: string;
  createdAt: Date;
}

// ── Channel Service ─────────────────────────────────────────────

export class ChannelService {
  private get collection() {
    return getDatabase().collection<AgentChannel>('agent_channels');
  }

  /**
   * Add a channel to an agent
   */
  async addChannel(agentId: string, userId: string, request: AddChannelRequest): Promise<ChannelStatusResponse> {
    // Validate credentials
    if (request.type !== 'webchat' && request.type !== 'whatsapp') {
      const validation = validateChannelCredentials(request.type, request.credentials);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid credentials');
      }
    }

    // Check if channel already exists for this agent
    const existing = await this.collection.findOne({ agentId, type: request.type });
    if (existing) {
      throw new Error(`Channel ${request.type} already configured for this agent`);
    }

    const channel: AgentChannel = {
      agentId,
      userId,
      type: request.type,
      status: request.type === 'webchat' ? 'connected' : 'pending',
      config: {
        dmPolicy: request.dmPolicy || 'pairing',
        allowFrom: request.allowFrom || [],
        groupPolicy: request.groupPolicy,
        groupAllowFrom: request.groupAllowFrom,
      },
      credentials: {
        encrypted: request.credentials
          ? encrypt(JSON.stringify(request.credentials))
          : encrypt('{}'),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.collection.insertOne(channel as any);

    // Update OpenClaw config in the container
    await this.syncChannelsToConfig(agentId);

    return {
      type: channel.type,
      status: channel.status,
      dmPolicy: channel.config.dmPolicy,
      createdAt: channel.createdAt,
    };
  }

  /**
   * Remove a channel from an agent.
   * Uses agentId+type so org members can remove channels added by others.
   * Attempts Gateway logout first for clean disconnect (non-fatal if Gateway unreachable).
   */
  async removeChannel(agentId: string, _userId: string, channelType: ChannelType): Promise<void> {
    if (channelType === 'webchat') {
      throw new Error('WebChat channel cannot be removed');
    }

    // Try to cleanly disconnect from Gateway first (non-fatal)
    const openClawChannels = ['whatsapp', 'telegram', 'discord', 'slack', 'signal', 'imessage', 'msteams', 'mattermost', 'matrix', 'googlechat', 'feishu', 'line', 'bluebubbles'];
    if (openClawChannels.includes(channelType)) {
      try {
        const { gatewayManager } = await import('./gateway-ws.service.js');
        const client = gatewayManager.getClient(agentId);
        if (client?.isConnected()) {
          await client.channelLogout(channelType);
          console.log(`[channels] Gateway logout for ${channelType} before remove`);
        }
      } catch (e) {
        console.warn(`[channels] Gateway logout before remove failed for ${agentId}/${channelType}:`, e instanceof Error ? e.message : e);
      }
    }

    const result = await this.collection.deleteOne({ agentId, type: channelType });
    if (result.deletedCount === 0) {
      throw new Error('Channel not found');
    }

    // Update OpenClaw config (pass removed type so we can null it in config)
    await this.syncChannelsToConfig(agentId, channelType);
  }

  /**
   * Get decrypted Superchat API key for an agent (for live channel listing)
   */
  async getSuperchatApiKey(agentId: string, userId: string): Promise<string | null> {
    const doc = await this.collection.findOne({ agentId, userId, type: 'superchat' });
    if (!doc?.credentials?.encrypted) return null;
    try {
      const raw = decrypt(doc.credentials.encrypted);
      const creds = JSON.parse(raw) as { apiKey?: string };
      return creds?.apiKey ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get all channels for an agent
   */
  async getChannels(agentId: string, userId: string): Promise<ChannelStatusResponse[]> {
    const channels = await this.collection
      .find({ agentId, userId })
      .sort({ createdAt: -1 })
      .toArray();

    // Always include webchat
    const hasWebchat = channels.some(ch => ch.type === 'webchat');
    const result: ChannelStatusResponse[] = channels.map(ch => ({
      type: ch.type,
      status: ch.status,
      dmPolicy: ch.config.dmPolicy,
      allowFrom: ch.config.allowFrom,
      errorMessage: ch.errorMessage,
      createdAt: ch.createdAt,
    }));

    if (!hasWebchat) {
      result.unshift({
        type: 'webchat',
        status: 'connected',
        createdAt: new Date(),
      });
    }

    return result;
  }

  /**
   * Update channel config (dmPolicy, allowFrom, etc.)
   */
  async updateChannelConfig(
    agentId: string,
    userId: string,
    channelType: ChannelType,
    updates: {
      dmPolicy?: DmPolicy;
      allowFrom?: string[];
      groupPolicy?: GroupPolicy;
      groupAllowFrom?: string[];
    }
  ): Promise<void> {
    const setFields: Record<string, any> = { updatedAt: new Date() };
    if (updates.dmPolicy !== undefined) setFields['config.dmPolicy'] = updates.dmPolicy;
    if (updates.allowFrom !== undefined) setFields['config.allowFrom'] = updates.allowFrom;
    if (updates.groupPolicy !== undefined) setFields['config.groupPolicy'] = updates.groupPolicy;
    if (updates.groupAllowFrom !== undefined) setFields['config.groupAllowFrom'] = updates.groupAllowFrom;

    const result = await this.collection.updateOne(
      { agentId, userId, type: channelType },
      { $set: setFields }
    );

    if (result.matchedCount === 0) {
      throw new Error('Channel not found');
    }

    // Sync to OpenClaw config
    await this.syncChannelsToConfig(agentId);
  }

  /**
   * Update channel status (called from gateway WS events)
   */
  async updateChannelStatus(
    agentId: string,
    channelType: ChannelType,
    status: 'connected' | 'disconnected' | 'error',
    errorMessage?: string
  ): Promise<void> {
    await this.collection.updateOne(
      { agentId, type: channelType },
      {
        $set: {
          status,
          errorMessage: errorMessage || undefined,
          updatedAt: new Date(),
        },
      }
    );
  }

  /**
   * Build ChannelDeployConfig array from stored channels
   */
  async getDeployConfigs(agentId: string): Promise<ChannelDeployConfig[]> {
    const channels = await this.collection.find({ agentId }).toArray();
    const configs: ChannelDeployConfig[] = [];

    for (const ch of channels) {
      let credentials: { botToken?: string; appToken?: string } | undefined;

      try {
        credentials = JSON.parse(decrypt(ch.credentials.encrypted));
      } catch {
        credentials = undefined;
      }

      configs.push({
        type: ch.type,
        credentials,
        dmPolicy: ch.config.dmPolicy,
        allowFrom: ch.config.allowFrom,
        groupPolicy: ch.config.groupPolicy,
        groupAllowFrom: ch.config.groupAllowFrom,
      });
    }

    return configs;
  }

  /**
   * Sync channel configs to the running OpenClaw container.
   * When removedChannelType is set, we explicitly null it so deepMerge removes it.
   */
  private async syncChannelsToConfig(agentId: string, removedChannelType?: ChannelType): Promise<void> {
    try {
      const channels = await this.collection.find({ agentId }).toArray();
      // WebChat is NOT an OpenClaw channel — it's the built-in Gateway WebSocket UI.
      // Do NOT add channels.webchat; it causes "unknown channel id: webchat".
      const channelsConfig: ChannelsConfig = {};

      for (const ch of channels) {
        let creds: any = {};
        try {
          creds = JSON.parse(decrypt(ch.credentials.encrypted));
        } catch {
          // Skip channels with invalid credentials
          continue;
        }

        switch (ch.type) {
          case 'telegram':
            channelsConfig.telegram = {
              botToken: creds.botToken,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
              groupPolicy: ch.config.groupPolicy || 'allowlist',
              groupAllowFrom: ch.config.groupAllowFrom || [],
              groups: { '*': { requireMention: true } },
            };
            break;
          case 'discord':
            channelsConfig.discord = {
              token: creds.botToken,
              dm: {
                enabled: true,
                policy: ch.config.dmPolicy || 'pairing',
                allowFrom: ch.config.allowFrom || [],
              },
              guilds: { '*': { requireMention: true } },
            };
            break;
          case 'slack':
            channelsConfig.slack = {
              botToken: creds.botToken,
              appToken: creds.appToken,
              dm: {
                enabled: true,
                policy: ch.config.dmPolicy || 'pairing',
                allowFrom: ch.config.allowFrom || [],
              },
              channels: { '*': { requireMention: true } },
            };
            break;
          case 'whatsapp':
            channelsConfig.whatsapp = {
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
              groupPolicy: ch.config.groupPolicy || 'allowlist',
              groupAllowFrom: ch.config.groupAllowFrom || [],
              groups: { '*': { requireMention: true } },
            };
            break;
          case 'signal':
            channelsConfig.signal = {
              enabled: true,
              phoneNumber: creds.phoneNumber,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'imessage':
            channelsConfig.imessage = {
              enabled: true,
              bridgeUrl: creds.bridgeUrl,
              bridgePassword: creds.bridgePassword,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'msteams':
            channelsConfig.msteams = {
              enabled: true,
              appId: creds.appId,
              appSecret: creds.appSecret,
              tenantId: creds.tenantId,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'mattermost':
            channelsConfig.mattermost = {
              enabled: true,
              url: creds.url,
              botToken: creds.botToken,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'matrix':
            channelsConfig.matrix = {
              enabled: true,
              homeserverUrl: creds.homeserverUrl,
              accessToken: creds.accessToken,
              userId: creds.userId,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'googlechat':
            channelsConfig.googlechat = {
              enabled: true,
              serviceAccountKey: creds.serviceAccountKey,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'feishu':
            channelsConfig.feishu = {
              enabled: true,
              appId: creds.appId,
              appSecret: creds.appSecret,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'line':
            channelsConfig.line = {
              channelAccessToken: creds.channelAccessToken,
              channelSecret: creds.channelSecret,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'bluebubbles':
            channelsConfig.bluebubbles = {
              bridgeUrl: creds.bridgeUrl,
              bridgePassword: creds.bridgePassword,
              dmPolicy: ch.config.dmPolicy || 'pairing',
              allowFrom: ch.config.allowFrom || [],
            };
            break;
          case 'superchat':
            // Superchat is NOT an OpenClaw channel — handled by Havoc bridge.
            // But we need to enable the havoc-superchat plugin + superchat tool.
            break;
          // webchat is NOT an OpenClaw channel — skip it
        }
      }

      // Build plugins.entries for all active channels (must be explicitly enabled)
      const pluginEntries: Record<string, { enabled: boolean }> = {};
      if (channelsConfig.whatsapp) pluginEntries.whatsapp = { enabled: true };
      if (channelsConfig.telegram) pluginEntries.telegram = { enabled: true };
      if (channelsConfig.discord) pluginEntries.discord = { enabled: true };
      if (channelsConfig.slack) pluginEntries.slack = { enabled: true };
      if (channelsConfig.signal) pluginEntries.signal = { enabled: true };
      if ((channelsConfig as any).bluebubbles) pluginEntries.bluebubbles = { enabled: true };
      if ((channelsConfig as any).line) pluginEntries.line = { enabled: true };
      if ((channelsConfig as any).googlechat) pluginEntries.googlechat = { enabled: true };
      if ((channelsConfig as any).msteams) pluginEntries.msteams = { enabled: true };
      if ((channelsConfig as any).mattermost) pluginEntries.mattermost = { enabled: true };
      if ((channelsConfig as any).matrix) pluginEntries.matrix = { enabled: true };
      if ((channelsConfig as any).feishu) pluginEntries.feishu = { enabled: true };

      // Superchat: enable havoc-superchat plugin + load path + tool
      const hasSuperchat = channels.some(ch => ch.type === 'superchat');
      if (hasSuperchat) {
        pluginEntries['havoc-superchat'] = { enabled: true };
      }

      // Build web provider config when WhatsApp is present (Baileys / WhatsApp Web)
      // When removing WhatsApp, explicitly set web: null so deepMerge removes it
      const webConfig = channelsConfig.whatsapp
        ? {
            web: {
              enabled: true,
              heartbeatSeconds: 60,
              reconnect: {
                initialMs: 2000,
                maxMs: 120000,
                factor: 1.4,
                jitter: 0.2,
                maxAttempts: 0,
              },
            },
          }
        : removedChannelType === 'whatsapp'
          ? { web: null }
          : {};

      // Explicitly null removed channel so deepMerge strips it (otherwise it stays)
      const channelsToSend = { ...channelsConfig };
      const pluginsToSend = { ...pluginEntries };
      if (removedChannelType && removedChannelType !== 'webchat' && removedChannelType !== 'superchat') {
        (channelsToSend as any)[removedChannelType] = null;
        (pluginsToSend as any)[removedChannelType] = null;
      }

      // Hot-reload: update channels, plugins, and web provider sections
      const superchatConfig = hasSuperchat ? {
        plugins: { load: { paths: ['/opt/havoc-superchat'] }, entries: pluginsToSend },
        tools: { alsoAllow: ['superchat'] },
      } : { plugins: { entries: pluginsToSend } };

      await deploymentService.updateAgentConfig(agentId, {
        channels: channelsToSend,
        ...superchatConfig,
        ...webConfig,
      } as any);

      // WhatsApp: restart container when adding (load provider) OR removing (clear session)
      const shouldRestartForWhatsApp = channelsConfig.whatsapp || removedChannelType === 'whatsapp';
      if (shouldRestartForWhatsApp) {
        const db = getDatabase();
        const agent = await db.collection('agents').findOne(
          { _id: new ObjectId(agentId) },
          { projection: { status: 1, containerId: 1 } }
        );
        if (agent?.status === 'running' && agent?.containerId) {
          try {
            await deploymentService.restartAgent(agent.containerId as string);
            console.log(`[channels] Restarted agent ${agentId} (WhatsApp ${removedChannelType === 'whatsapp' ? 'removed' : 'synced'})`);
          } catch (restartErr) {
            console.warn(`[channels] Restart after WhatsApp sync failed for ${agentId}:`, restartErr);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to sync channels for agent ${agentId}:`, error);
    }
  }
}

export const channelService = new ChannelService();
