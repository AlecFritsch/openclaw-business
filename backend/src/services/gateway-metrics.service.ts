/**
 * GatewayMetricsSync — Syncs message counts and usage from OpenClaw gateway to agent docs.
 * BYOK: No credit deduction. Only metrics for display.
 */

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';
import { gatewayManager } from './gateway-ws.service.js';

const POLL_INTERVAL_MS = 60_000;

class GatewayMetricsSync {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;
    console.log('[gateway-metrics] Starting sync loop');
    setTimeout(() => this.poll(), 30_000);
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[gateway-metrics] Stopped');
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const connectedAgentIds = gatewayManager.getConnectedAgents();
      if (connectedAgentIds.length === 0) return;

      const objectIds = connectedAgentIds
        .map(id => { try { return new ObjectId(id); } catch { return null; } })
        .filter(Boolean) as ObjectId[];
      if (objectIds.length === 0) return;

      const agents = await getDatabase().collection('agents').find({
        _id: { $in: objectIds },
        status: 'running',
      }).project({ _id: 1 }).toArray();

      for (const agent of agents) {
        await this.syncAgent(agent._id!.toString(), agent._id).catch(err =>
          console.warn('[gateway-metrics] Failed agent', agent._id, err instanceof Error ? err.message : err),
        );
      }
    } catch (err) {
      console.error('[gateway-metrics] Poll error:', err instanceof Error ? err.message : err);
    } finally {
      this.running = false;
    }
  }

  private async syncAgent(agentId: string, agentObjectId: ObjectId): Promise<void> {
    const client = gatewayManager.getClient(agentId);
    if (!client?.isConnected()) return;

    try {
      const usage = await client.sessionsUsage();
      if (!usage?.aggregates?.messages) return;

      await getDatabase().collection('agents').updateOne(
        { _id: agentObjectId },
        { $set: {
          'metrics.gatewayMessages': usage.aggregates.messages.user || 0,
          'metrics.totalTokens': usage.totals?.totalTokens || 0,
          'metrics.totalCost': usage.totals?.totalCost || 0,
          'metrics.lastActive': new Date(),
        } },
      );
    } catch { /* non-critical */ }
  }

  async forcePoll(): Promise<void> {
    await this.poll();
  }
}

export const gatewayMetricsSync = new GatewayMetricsSync();
