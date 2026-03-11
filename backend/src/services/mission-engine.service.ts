// Mission Engine Service — autonomous agent mission execution
// Owns mission lifecycle: create → register trigger → execute → capture output → deliver → chain

import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { gatewayManager } from './gateway-ws.service.js';
import { EventEmitter } from 'events';
import type { MissionStatus, MissionRunStatus, MissionTrigger, MissionStats, MissionDelivery } from '@openclaw-business/shared';

const emitter = new EventEmitter();
export const missionEvents = emitter;

/** Internal mission document shape (from MongoDB) */
interface MissionDoc {
  _id: ObjectId;
  agentId: string;
  organizationId: string;
  name: string;
  description: string;
  status: MissionStatus;
  trigger: MissionTrigger;
  prompt: string;
  capabilities: string[];
  delivery?: MissionDelivery;
  dependencies: string[];
  currentRunId: string | null;
  stats: MissionStats;
  cronJobId: string | null;
  cronJobIds?: string[];
  /** Stored for retry when gateway wasn't ready */
  triggerConfigs?: Array<{ id: string; schedule?: string; every?: string; tz?: string }>;
}

/** Extract the [TRIGGER: id] section from prompt for multi-trigger missions */
function extractTriggerSection(prompt: string, triggerId: string): string {
  const re = new RegExp(`\\[TRIGGER:\\s*${triggerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\[TRIGGER:|$)`, 'i');
  const m = prompt.match(re);
  return m ? m[1].trim() : prompt;
}

function db() { return getDatabase(); }
function missions() { return db().collection('missions'); }
function missionRuns() { return db().collection('mission_runs'); }

// ── Trigger Registration ────────────────────────────────────

export async function registerTrigger(missionDoc: Partial<MissionDoc> & Pick<MissionDoc, '_id' | 'agentId' | 'name' | 'prompt' | 'trigger'>): Promise<string | null> {
  const { trigger, _id, agentId, name, prompt } = missionDoc;
  if (!trigger || trigger.type === 'manual') return null;

  if (trigger.type === 'schedule' || trigger.type === 'interval') {
    try {
      const gw = gatewayManager.getClient(agentId);
      if (!gw) return null;

      const tz = trigger.config.tz as string | undefined;
      const schedule = trigger.type === 'schedule'
        ? { kind: 'cron' as const, expr: trigger.config.expr as string, ...(tz ? { tz } : {}) }
        : { kind: 'every' as const, everyMs: trigger.config.everyMs as number };

      const jobId = await gw.addCronJob({
        name: `mission:${_id.toString()}:${name}`,
        sessionTarget: 'isolated',
        payload: { kind: 'agentTurn', message: prompt },
        schedule,
        description: `Havoc Mission: ${name}`,
      });
      return jobId;
    } catch (err) {
      console.error(`[mission-engine] Failed to register cron for mission ${_id}:`, (err as Error).message);
      return null;
    }
  }

  // channel_message, webhook, mission_complete — tracked in DB, matched at runtime
  return null;
}

export async function unregisterTrigger(missionDoc: Pick<MissionDoc, 'agentId' | 'cronJobId' | 'cronJobIds'>): Promise<void> {
  const ids = [
    ...(missionDoc.cronJobId ? [missionDoc.cronJobId] : []),
    ...(missionDoc.cronJobIds || []),
  ];
  if (ids.length === 0) return;
  try {
    const gw = gatewayManager.getClient(missionDoc.agentId);
    if (gw) {
      for (const id of ids) await gw.removeCronJob(id);
    }
  } catch (err) {
    console.error(`[mission-engine] Failed to remove crons:`, (err as Error).message);
  }
}

/** Register multiple triggers for one mission (one use case = one mission) */
export async function registerTriggers(
  missionDoc: Pick<MissionDoc, '_id' | 'agentId' | 'name' | 'prompt'>,
  triggers: Array<{ id: string; schedule?: string; every?: string; tz?: string }>,
): Promise<string[]> {
  const jobIds: string[] = [];
  try {
    const gw = gatewayManager.getClient(missionDoc.agentId);
    if (!gw) return jobIds;

    for (const t of triggers) {
      const promptSection = extractTriggerSection(missionDoc.prompt, t.id);
      const schedule = t.schedule
        ? { kind: 'cron' as const, expr: t.schedule, ...(t.tz ? { tz: t.tz } : {}) }
        : { kind: 'every' as const, everyMs: parseEveryMs(t.every || '30m') };

      const jobId = await gw.addCronJob({
        name: `mission:${missionDoc._id.toString()}:${missionDoc.name}:${t.id}`,
        sessionTarget: 'isolated',
        payload: { kind: 'agentTurn', message: promptSection },
        schedule,
        description: `Havoc: ${missionDoc.name} (${t.id})`,
      });
      jobIds.push(jobId);
    }
  } catch (err) {
    console.error(`[mission-engine] Failed to register triggers for mission ${missionDoc._id}:`, (err as Error).message);
  }
  return jobIds;
}

/** Retry registration for missions that have triggers but missing cron jobs (e.g. gateway wasn't ready) */
export async function retryMissionTriggers(agentId: string): Promise<{ retried: number; ok: number }> {
  const docs = await missions()
    .find({ agentId, status: { $in: ['idle', 'paused'] }, triggerConfigs: { $exists: true, $ne: [] } })
    .toArray() as MissionDoc[];

  let ok = 0;
  for (const doc of docs) {
    const triggers = doc.triggerConfigs;
    if (!triggers?.length) continue;

    const existingIds = doc.cronJobIds || [];
    if (existingIds.length >= triggers.length) continue;

    const jobIds = await registerTriggers(
      { _id: doc._id, agentId: doc.agentId, name: doc.name, prompt: doc.prompt },
      triggers,
    );
    if (jobIds.length > 0) {
      await missions().updateOne(
        { _id: doc._id },
        { $set: { cronJobIds: jobIds, updatedAt: new Date() } },
      );
      ok++;
    }
  }
  return { retried: docs.length, ok };
}

function parseEveryMs(s: string): number {
  const m = s.match(/^(\d+)\s*(s|m|h|d|sec|min|hr)?$/i);
  if (!m) return 30 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const u = (m[2] || 'm').toLowerCase();
  if (u.startsWith('s') || u === 'sec') return n * 1000;
  if (u.startsWith('m') || u === 'min') return n * 60 * 1000;
  if (u.startsWith('h') || u === 'hr') return n * 3600 * 1000;
  if (u === 'd') return n * 86400 * 1000;
  return n * 60 * 1000;
}

// ── Execution ───────────────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_CONCURRENT_RUNS_PER_AGENT = 3;

export async function executeMission(
  missionId: string,
  triggerContext?: { type: string; input?: unknown },
): Promise<string> {
  const mission = await missions().findOne({ _id: new ObjectId(missionId) }) as MissionDoc | null;
  if (!mission) throw new Error('Mission not found');
  if (mission.status === 'paused' || mission.status === 'archived') throw new Error(`Mission is ${mission.status}`);

  // Rate limit: max concurrent runs per agent
  const activeRuns = await missionRuns().countDocuments({ agentId: mission.agentId, status: 'running' });
  if (activeRuns >= MAX_CONCURRENT_RUNS_PER_AGENT) throw new Error('Too many concurrent mission runs for this agent');

  const runId = new ObjectId();
  const now = new Date();

  // Create run doc
  await missionRuns().insertOne({
    _id: runId,
    missionId,
    agentId: mission.agentId,
    organizationId: mission.organizationId,
    status: 'running' as MissionRunStatus,
    triggerType: triggerContext?.type || 'manual',
    input: triggerContext?.input || null,
    output: null,
    error: null,
    sessionKey: null,
    startedAt: now,
    completedAt: null,
    durationMs: null,
  });

  // Set mission running
  await missions().updateOne(
    { _id: new ObjectId(missionId) },
    { $set: { status: 'running' as MissionStatus, currentRunId: runId.toString(), updatedAt: now } },
  );

  emitter.emit('mission:started', { missionId, runId: runId.toString(), agentId: mission.agentId });

  // Execute async
  executeAsync(mission, runId.toString()).catch((err) => {
    console.error(`[mission-engine] Run ${runId} failed:`, (err as Error).message);
  });

  return runId.toString();
}

async function executeAsync(mission: MissionDoc, runId: string): Promise<void> {
  const startMs = Date.now();
  let output: string | null = null;
  let error: string | null = null;
  let status: MissionRunStatus = 'completed';
  let sessionKey: string | null = null;

  try {
    const gw = gatewayManager.getClient(mission.agentId);
    if (!gw) throw new Error('Gateway not connected');

    // Build prompt with trigger context
    const run = await missionRuns().findOne({ _id: new ObjectId(runId) });
    let fullPrompt = mission.prompt;
    if (run?.input) {
      fullPrompt = `[Mission Context]\n${JSON.stringify(run.input, null, 2)}\n\n[Mission Instruction]\n${mission.prompt}`;
    }

    // Send to isolated session via chat.send
    sessionKey = `mission:${mission._id}:${runId}`;
    const result = await gw.sendMessage(sessionKey, fullPrompt);
    // sendMessage is non-blocking (returns runId), output comes via cron delivery or session history
    // For now, we mark as completed — the agent runs autonomously
    output = result?.runId ? `Agent run started (${result.runId})` : 'Sent to agent';
  } catch (err) {
    error = (err as Error).message;
    status = 'failed';
  }

  const durationMs = Date.now() - startMs;
  const completedAt = new Date();

  // Update run
  await missionRuns().updateOne(
    { _id: new ObjectId(runId) },
    { $set: { status, output, error, sessionKey, completedAt, durationMs } },
  );

  // Update mission stats
  const prevStats = mission.stats || { totalRuns: 0, avgDurationMs: 0, successRate: 1, consecutiveFailures: 0 };
  const newTotal = prevStats.totalRuns + 1;
  const newAvg = Math.round((prevStats.avgDurationMs * prevStats.totalRuns + durationMs) / newTotal);
  const successes = Math.round(prevStats.successRate * prevStats.totalRuns) + (status === 'completed' ? 1 : 0);
  const newRate = newTotal > 0 ? successes / newTotal : 1;
  const newConsecFail = status === 'failed' ? prevStats.consecutiveFailures + 1 : 0;

  const missionUpdate: Record<string, unknown> = {
    currentRunId: null,
    updatedAt: completedAt,
    'stats.totalRuns': newTotal,
    'stats.lastRunAt': completedAt.toISOString(),
    'stats.avgDurationMs': newAvg,
    'stats.successRate': Math.round(newRate * 100) / 100,
    'stats.consecutiveFailures': newConsecFail,
  };

  // Auto-pause after too many consecutive failures
  if (newConsecFail >= MAX_CONSECUTIVE_FAILURES) {
    missionUpdate.status = 'paused';
  } else if (mission.trigger?.type === 'manual' && status === 'completed') {
    missionUpdate.status = 'completed';
  } else {
    missionUpdate.status = 'idle';
  }

  await missions().updateOne({ _id: mission._id }, { $set: missionUpdate });

  emitter.emit('mission:completed', {
    missionId: mission._id.toString(),
    runId,
    agentId: mission.agentId,
    status,
    output,
  });

  // Chain: trigger dependent missions
  if (status === 'completed') {
    const dependents = await missions().find({
      agentId: mission.agentId,
      'trigger.type': 'mission_complete',
      'trigger.config.missionId': mission._id.toString(),
      status: { $in: ['idle'] },
    }).toArray();

    for (const dep of dependents) {
      executeMission(dep._id.toString(), { type: 'mission_complete', input: { parentMissionId: mission._id.toString(), output } }).catch(() => {});
    }
  }
}

// ── Channel Message Matching ────────────────────────────────

export async function matchChannelMessage(
  agentId: string,
  message: string,
  channel: string,
  sender?: string,
): Promise<void> {
  const channelMissions = await missions().find({
    agentId,
    'trigger.type': 'channel_message',
    status: 'idle',
  }).toArray() as unknown as MissionDoc[];

  for (const m of channelMissions) {
    const cfg = m.trigger?.config || {};
    if (cfg.channel && cfg.channel !== channel) continue;
    if (cfg.filter) {
      try {
        const re = new RegExp(cfg.filter as string, 'i');
        if (!re.test(message)) continue;
      } catch {
        if (!message.toLowerCase().includes((cfg.filter as string).toLowerCase())) continue;
      }
    }
    executeMission(m._id.toString(), { type: 'channel_message', input: { message, channel, sender } }).catch(() => {});
  }
}
