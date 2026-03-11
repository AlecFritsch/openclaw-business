// Webhook Service - Manages external webhook triggers per agent
// Generates unique webhook URLs and syncs hooks config to OpenClaw

import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { config } from '../config/env.js';
import { deploymentService } from './deployment.service.js';
import type { HookMapping, HooksConfig } from '@openclaw-business/shared';

// ── Types ───────────────────────────────────────────────────────

export interface AgentWebhook {
  agentId: string;
  userId: string;
  name: string;
  token: string;
  path: string;
  enabled: boolean;
  mappings: HookMapping[];
  triggerCount: number;
  lastTriggeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookRequest {
  name: string;
  mappings?: HookMapping[];
}

export interface WebhookInfo {
  name: string;
  webhookUrl: string;
  token: string;
  enabled: boolean;
  triggerCount: number;
  lastTriggeredAt?: Date;
  createdAt: Date;
}

// ── Webhook Service ─────────────────────────────────────────────

export class WebhookService {
  private get collection() {
    return getDatabase().collection<AgentWebhook>('agent_webhooks');
  }

  /** Holt den Gateway-Port des Agents (jeder Agent hat eigenen Port) */
  private async getAgentPort(agentId: string): Promise<number> {
    const agent = await getDatabase()
      .collection('agents')
      .findOne({ _id: new ObjectId(agentId) as any }, { projection: { internalPort: 1 } });
    return (agent as any)?.internalPort ?? config.openclawBasePort;
  }

  /**
   * Create a webhook endpoint for an agent
   */
  async createWebhook(agentId: string, userId: string, request: CreateWebhookRequest): Promise<WebhookInfo> {
    const token = crypto.randomBytes(24).toString('hex');
    const path = `/hooks/${agentId}`;

    const webhook: AgentWebhook = {
      agentId,
      userId,
      name: request.name,
      token,
      path,
      enabled: true,
      mappings: request.mappings || [
        {
          match: { path: 'default' },
          action: 'agent',
          agentId: 'main',
          deliver: true,
        },
      ],
      triggerCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.collection.insertOne(webhook as any);

    // Sync to OpenClaw config
    await this.syncWebhooksToConfig(agentId);

    const port = await this.getAgentPort(agentId);
    return {
      name: webhook.name,
      webhookUrl: `http://localhost:${port}${path}`,
      token: webhook.token,
      enabled: webhook.enabled,
      triggerCount: 0,
      createdAt: webhook.createdAt,
    };
  }

  /**
   * Get all webhooks for an agent.
   * Bei organizationId: alle Webhooks des Agents (für Org-Mitglieder).
   * Sonst: nur Webhooks des Erstellers (userId).
   */
  async getWebhooks(agentId: string, userId: string, organizationId?: string): Promise<WebhookInfo[]> {
    const filter: any = { agentId };
    if (!organizationId) filter.userId = userId;
    const webhooks = await this.collection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    const port = await this.getAgentPort(agentId);
    return webhooks.map(wh => ({
      name: wh.name,
      webhookUrl: `http://localhost:${port}${wh.path}`,
      token: wh.token,
      enabled: wh.enabled,
      triggerCount: wh.triggerCount,
      lastTriggeredAt: wh.lastTriggeredAt,
      createdAt: wh.createdAt,
    }));
  }

  /**
   * Toggle webhook enabled/disabled.
   * Bei organizationId: alle Webhooks des Agents (Org-Mitglieder).
   */
  async toggleWebhook(agentId: string, userId: string, name: string, enabled: boolean, organizationId?: string): Promise<void> {
    const filter: any = { agentId, name };
    if (!organizationId) filter.userId = userId;
    await this.collection.updateOne(filter, { $set: { enabled, updatedAt: new Date() } });
    await this.syncWebhooksToConfig(agentId);
  }

  /**
   * Delete a webhook.
   * Bei organizationId: alle Webhooks des Agents (Org-Mitglieder).
   */
  async deleteWebhook(agentId: string, userId: string, name: string, organizationId?: string): Promise<void> {
    const filter: any = { agentId, name };
    if (!organizationId) filter.userId = userId;
    await this.collection.deleteOne(filter);
    await this.syncWebhooksToConfig(agentId);
  }

  /**
   * Record a webhook trigger (called when webhook is hit)
   */
  async recordTrigger(agentId: string, path: string): Promise<void> {
    await this.collection.updateOne(
      { agentId, path },
      { $inc: { triggerCount: 1 }, $set: { lastTriggeredAt: new Date() } }
    );
  }

  /**
   * Sync webhooks to OpenClaw hooks config
   */
  private async syncWebhooksToConfig(agentId: string): Promise<void> {
    try {
      const webhooks = await this.collection.find({ agentId, enabled: true }).toArray();

      if (webhooks.length === 0) {
        await deploymentService.updateAgentConfig(agentId, {
          hooks: { enabled: false },
        });
        return;
      }

      // Use the first webhook's token (all webhooks share the gateway hooks endpoint)
      // 2026.2.12+ security: defaultSessionKey + allowRequestSessionKey=false
      const hooksConfig: HooksConfig = {
        enabled: true,
        token: webhooks[0].token,
        path: '/hooks',
        mappings: webhooks.flatMap(wh => wh.mappings),
        defaultSessionKey: 'hook:ingress',
        allowRequestSessionKey: false,
        allowedSessionKeyPrefixes: ['hook:'],
      };

      await deploymentService.updateAgentConfig(agentId, {
        hooks: hooksConfig,
      });
    } catch (error) {
      console.error(`Failed to sync webhooks for agent ${agentId}:`, error);
    }
  }
}

export const webhookService = new WebhookService();
