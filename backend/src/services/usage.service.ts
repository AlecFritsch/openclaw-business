// ── Usage Aggregation Service ────────────────────────────────────
// Centralized service for usage metrics, model breakdown, export.

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';

export interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalMessages: number;
  activeAgents: number;
  totalAgents: number;
}

export interface ModelBreakdownEntry {
  model: string;
  messages: number;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

export interface AgentBreakdownEntry {
  agentId: string;
  agentName: string;
  status: string;
  messages: number;
  cost: number;
  tokens: number;
  lastActive?: string;
}

export interface TimeseriesEntry {
  date: string;
  messages: number;
  cost: number;
  tokens: number;
}

export interface UsageExportParams {
  from: string;
  to: string;
  format: 'json' | 'csv';
  scope?: 'org' | 'agent';
  agentId?: string;
}

class UsageService {
  private get db() { return getDatabase(); }

  async getUsageSummary(organizationId: string, from?: string, to?: string, agentId?: string): Promise<UsageSummary> {
    const filter: any = { organizationId };
    if (agentId) filter._id = new ObjectId(agentId);
    const agents = await this.db.collection('agents').find(filter).toArray();

    const totalAgents = agents.length;
    const activeAgents = agents.filter(a => a.status === 'running').length;
    const totalMessages = agents.reduce((s, a) => s + (a.metrics?.totalMessages || 0), 0);
    const totalCost = agents.reduce((s, a) => s + (a.metrics?.totalCost || 0), 0);
    const totalTokens = agents.reduce((s, a) => s + (a.metrics?.totalTokens || 0), 0);
    const totalInputTokens = agents.reduce((s, a) => s + (a.metrics?.totalInputTokens || 0), 0);
    const totalOutputTokens = agents.reduce((s, a) => s + (a.metrics?.totalOutputTokens || 0), 0);

    return { totalCost, totalTokens, totalInputTokens, totalOutputTokens, totalMessages, activeAgents, totalAgents };
  }

  async getModelBreakdown(organizationId: string, from?: string, to?: string, agentId?: string): Promise<ModelBreakdownEntry[]> {
    const filter: any = { organizationId };
    if (agentId) filter._id = new ObjectId(agentId);
    const agents = await this.db.collection('agents').find(filter).project({ _id: 1 }).toArray();
    const agentIds = agents.map(a => a._id!.toString());
    if (agentIds.length === 0) return [];

    const match: any = {
      agentId: { $in: agentIds },
      'metadata.model': { $exists: true },
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    const result = await this.db.collection('messages').aggregate([
      { $match: match },
      {
        $group: {
          _id: '$metadata.model',
          messages: { $sum: 1 },
          cost: { $sum: { $ifNull: ['$metadata.cost', 0] } },
          tokens: { $sum: { $ifNull: ['$metadata.tokens', 0] } },
          inputTokens: { $sum: { $ifNull: ['$metadata.inputTokens', 0] } },
          outputTokens: { $sum: { $ifNull: ['$metadata.outputTokens', 0] } },
        },
      },
      { $sort: { cost: -1 } },
    ]).toArray();

    const totalCost = result.reduce((s, r) => s + r.cost, 0);

    return result.map(r => ({
      model: r._id || 'unknown',
      messages: r.messages,
      cost: r.cost,
      tokens: r.tokens,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      percentage: totalCost > 0 ? Math.round((r.cost / totalCost) * 10000) / 100 : 0,
    }));
  }

  async getAgentBreakdown(organizationId: string, agentId?: string): Promise<AgentBreakdownEntry[]> {
    const filter: any = { organizationId };
    if (agentId) filter._id = new ObjectId(agentId);
    const agents = await this.db.collection('agents').find(filter).toArray();
    return agents.map(a => ({
      agentId: a._id!.toString(),
      agentName: a.name,
      status: a.status,
      messages: a.metrics?.totalMessages || 0,
      cost: a.metrics?.totalCost || 0,
      tokens: a.metrics?.totalTokens || 0,
      lastActive: a.metrics?.lastActive?.toISOString?.() || a.updatedAt?.toISOString?.() || undefined,
    })).sort((a, b) => b.cost - a.cost);
  }

  async getDailyTimeseries(organizationId: string, from?: string, to?: string, agentId?: string): Promise<TimeseriesEntry[]> {
    const filter: any = { organizationId };
    if (agentId) filter._id = new ObjectId(agentId);
    const agents = await this.db.collection('agents').find(filter).project({ _id: 1 }).toArray();
    const agentIds = agents.map(a => a._id!.toString());
    if (agentIds.length === 0) return [];

    const match: any = { agentId: { $in: agentIds } };
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to) : new Date();
    match.createdAt = { $gte: fromDate, $lte: toDate };

    const result = await this.db.collection('messages').aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          messages: { $sum: 1 },
          cost: { $sum: { $ifNull: ['$metadata.cost', 0] } },
          tokens: { $sum: { $ifNull: ['$metadata.tokens', 0] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', messages: 1, cost: 1, tokens: 1 } },
    ]).toArray();

    return result as TimeseriesEntry[];
  }

  async exportUsage(organizationId: string, params: UsageExportParams): Promise<string> {
    const [summary, modelBreakdown, agentBreakdown, timeseries] = await Promise.all([
      this.getUsageSummary(organizationId, params.from, params.to, params.agentId),
      this.getModelBreakdown(organizationId, params.from, params.to, params.agentId),
      this.getAgentBreakdown(organizationId, params.agentId),
      this.getDailyTimeseries(organizationId, params.from, params.to, params.agentId),
    ]);

    if (params.format === 'json') {
      return JSON.stringify({ summary, modelBreakdown, agentBreakdown, timeseries, exportedAt: new Date().toISOString(), period: { from: params.from, to: params.to } }, null, 2);
    }

    // CSV: timeseries + model + agent breakdown
    const lines: string[] = [];
    lines.push('# Usage Export');
    lines.push(`# Period: ${params.from} to ${params.to}`);
    lines.push(`# Exported: ${new Date().toISOString()}`);
    lines.push('');

    lines.push('## Daily Timeseries');
    lines.push('date,messages,cost,tokens');
    for (const d of timeseries) {
      lines.push(`${d.date},${d.messages},${d.cost.toFixed(6)},${d.tokens}`);
    }
    lines.push('');

    lines.push('## Model Breakdown');
    lines.push('model,messages,cost,tokens,inputTokens,outputTokens,percentage');
    for (const m of modelBreakdown) {
      lines.push(`${m.model},${m.messages},${m.cost.toFixed(6)},${m.tokens},${m.inputTokens},${m.outputTokens},${m.percentage}`);
    }
    lines.push('');

    lines.push('## Agent Breakdown');
    lines.push('agentId,agentName,status,messages,cost,tokens');
    for (const a of agentBreakdown) {
      lines.push(`${a.agentId},"${a.agentName}",${a.status},${a.messages},${a.cost.toFixed(6)},${a.tokens}`);
    }

    return lines.join('\n');
  }
}

export const usageService = new UsageService();
