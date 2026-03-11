// Multi-Agent Service - Manages multiple agents within a single OpenClaw gateway
// Enterprise feature: route different channels/accounts to isolated agents

import { getDatabase } from '../config/database.js';
import { deploymentService } from './deployment.service.js';
import type {
  AgentEntry,
  Binding,
  BindingMatch,
  ChannelType,
  OpenClawFullConfig,
  ToolProfile,
} from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface SubAgentOverrides {
  model?: string;
  toolProfile?: string;
  toolAllow?: string[];
  toolDeny?: string[];
  sandboxMode?: string;     // 'inherit' | 'off' | 'non-main' | 'all'
  heartbeatEnabled?: boolean;
  heartbeatInterval?: string;
  identityName?: string;
  identityAvatar?: string;
}

export interface SubAgent {
  gatewayAgentId: string; // Parent gateway container agent ID
  subAgentId: string; // OpenClaw agent ID within the gateway
  userId: string;
  name: string;
  workspace: string;
  isDefault: boolean;
  bindings: BindingRule[];
  overrides?: SubAgentOverrides;
  createdAt: Date;
}

export interface BindingRule {
  channel: ChannelType;
  accountId?: string;
  peerKind?: 'direct' | 'group';
  peerId?: string;
}

export interface CreateSubAgentRequest {
  name: string;
  isDefault?: boolean;
  bindings?: BindingRule[];
}

// ── Multi-Agent Service ─────────────────────────────────────────

export class MultiAgentService {
  private get collection() {
    return getDatabase().collection<SubAgent>('gateway_sub_agents');
  }

  /**
   * Add a sub-agent to an existing gateway
   */
  async addSubAgent(
    gatewayAgentId: string,
    userId: string,
    request: CreateSubAgentRequest
  ): Promise<SubAgent> {
    const subAgentId = request.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Check for duplicate
    const existing = await this.collection.findOne({ gatewayAgentId, subAgentId });
    if (existing) {
      throw new Error(`Sub-agent "${subAgentId}" already exists in this gateway`);
    }

    const workspace = `/home/node/.openclaw/workspace-${subAgentId}`;

    const subAgent: SubAgent = {
      gatewayAgentId,
      subAgentId,
      userId,
      name: request.name,
      workspace,
      isDefault: request.isDefault || false,
      bindings: request.bindings || [],
      createdAt: new Date(),
    };

    await this.collection.insertOne(subAgent as any);

    // Sync to OpenClaw config
    await this.syncMultiAgentConfig(gatewayAgentId);

    return subAgent;
  }

  /**
   * Remove a sub-agent
   */
  async removeSubAgent(gatewayAgentId: string, userId: string, subAgentId: string): Promise<void> {
    const result = await this.collection.deleteOne({ gatewayAgentId, userId, subAgentId });
    if (result.deletedCount === 0) {
      throw new Error('Sub-agent not found');
    }

    await this.syncMultiAgentConfig(gatewayAgentId);
  }

  /**
   * List sub-agents for a gateway
   */
  async listSubAgents(gatewayAgentId: string, userId: string): Promise<SubAgent[]> {
    return this.collection.find({ gatewayAgentId, userId }).sort({ createdAt: 1 }).toArray();
  }

  /**
   * Update bindings for a sub-agent
   */
  async updateBindings(
    gatewayAgentId: string,
    userId: string,
    subAgentId: string,
    bindings: BindingRule[]
  ): Promise<void> {
    const result = await this.collection.updateOne(
      { gatewayAgentId, userId, subAgentId },
      { $set: { bindings } }
    );

    if (result.matchedCount === 0) {
      throw new Error('Sub-agent not found');
    }

    await this.syncMultiAgentConfig(gatewayAgentId);
  }

  /**
   * Update overrides for a sub-agent (model, tools, sandbox, heartbeat, identity)
   */
  async updateOverrides(
    gatewayAgentId: string,
    userId: string,
    subAgentId: string,
    overrides: SubAgentOverrides
  ): Promise<void> {
    const result = await this.collection.updateOne(
      { gatewayAgentId, userId, subAgentId },
      { $set: { overrides } }
    );

    if (result.matchedCount === 0) {
      throw new Error('Sub-agent not found');
    }

    await this.syncMultiAgentConfig(gatewayAgentId);
  }

  /**
   * Sync multi-agent config to OpenClaw
   */
  private async syncMultiAgentConfig(gatewayAgentId: string): Promise<void> {
    try {
      const subAgents = await this.collection.find({ gatewayAgentId }).toArray();

      if (subAgents.length === 0) {
        // No sub-agents: restore single-agent mode (clear list, bindings, agentToAgent)
        await deploymentService.updateAgentConfig(gatewayAgentId, {
          agents: { list: [] },
          bindings: [],
          tools: { agentToAgent: { enabled: false } },
        });
        return;
      }

      // Main agent MUST be first; sub-agents follow
      const mainEntry: AgentEntry = { id: 'main', default: true, workspace: '/home/node/.openclaw/workspace' };
      const subEntries: AgentEntry[] = subAgents.map(sa => ({
        id: sa.subAgentId,
        default: sa.isDefault,
        workspace: sa.workspace,
        ...(sa.overrides?.model ? { model: { primary: sa.overrides.model } } : {}),
        ...(sa.overrides?.toolAllow || sa.overrides?.toolDeny || sa.overrides?.toolProfile ? {
          tools: {
            ...(sa.overrides.toolProfile ? { profile: sa.overrides.toolProfile as ToolProfile } : {}),
            ...(sa.overrides.toolAllow ? { allow: sa.overrides.toolAllow } : {}),
            ...(sa.overrides.toolDeny ? { deny: sa.overrides.toolDeny } : {}),
          },
        } : {}),
        ...(sa.overrides?.sandboxMode && sa.overrides.sandboxMode !== 'inherit' ? {
          sandbox: { mode: sa.overrides.sandboxMode as 'off' | 'non-main' | 'all' },
        } : {}),
        ...(sa.overrides?.heartbeatEnabled !== undefined ? {
          heartbeat: {
            every: sa.overrides.heartbeatEnabled ? (sa.overrides.heartbeatInterval || '30m') : '0m',
          },
        } : {}),
        ...(sa.overrides?.identityName ? {
          identity: {
            name: sa.overrides.identityName,
            ...(sa.overrides.identityAvatar ? { avatar: sa.overrides.identityAvatar } : {}),
          },
        } : {}),
      }));
      const agentsList: AgentEntry[] = [mainEntry, ...subEntries];

      // Build bindings
      const bindings: Binding[] = [];
      for (const sa of subAgents) {
        for (const rule of sa.bindings) {
          const match: BindingMatch = {
            channel: rule.channel,
          };

          if (rule.accountId) match.accountId = rule.accountId;
          if (rule.peerKind || rule.peerId) {
            match.peer = {
              kind: rule.peerKind,
              id: rule.peerId,
            };
          }

          bindings.push({
            agentId: sa.subAgentId,
            match,
          });
        }
      }

      const agentIds = ['main', ...subAgents.map(sa => sa.subAgentId)];
      const updates: Partial<OpenClawFullConfig> = {
        agents: {
          list: agentsList,
          defaults: {
            subagents: { allowAgents: agentIds },
          },
        },
        bindings,
        tools: {
          agentToAgent: { enabled: true, allow: agentIds },
        },
      };

      await deploymentService.updateAgentConfig(gatewayAgentId, updates);
    } catch (error) {
      console.error(`Failed to sync multi-agent config for ${gatewayAgentId}:`, error);
    }
  }
}

export const multiAgentService = new MultiAgentService();
