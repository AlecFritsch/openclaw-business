// ── Havoc Mission Engine Types ──────────────────────────────

export type MissionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'archived';
export type MissionTriggerType = 'schedule' | 'interval' | 'event' | 'webhook' | 'channel_message' | 'mission_complete' | 'manual';
export type MissionRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface MissionTrigger {
  type: MissionTriggerType;
  config: Record<string, unknown>;
}

export interface MissionDelivery {
  channel?: string;
  target?: string;
}

export interface MissionStats {
  totalRuns: number;
  lastRunAt: string | null;
  avgDurationMs: number;
  successRate: number;
  consecutiveFailures: number;
}

export interface Mission {
  _id: string;
  agentId: string;
  organizationId: string;
  userId?: string;
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
  /** Multiple cron jobs when mission has multiple triggers */
  cronJobIds?: string[];
  /** Per-trigger config for multi-trigger missions (from Builder/Architect) */
  triggerConfigs?: MissionTriggerConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionRun {
  _id: string;
  missionId: string;
  agentId: string;
  organizationId: string;
  status: MissionRunStatus;
  triggerType: string;
  input?: unknown;
  output: string | null;
  error: string | null;
  sessionKey: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

/** Single trigger for multi-trigger missions (Builder/Architect format) */
export interface MissionTriggerConfig {
  id: string;
  schedule?: string;
  every?: string;
  /** IANA timezone for cron (e.g. Europe/Berlin). Default: gateway local */
  tz?: string;
}

export interface CreateMissionRequest {
  name: string;
  description?: string;
  trigger?: MissionTrigger;
  prompt: string;
  capabilities?: string[];
  delivery?: MissionDelivery;
  dependencies?: string[];
  /** One mission per use case: multiple triggers, one prompt with [TRIGGER: id] sections */
  triggers?: MissionTriggerConfig[];
}

export interface UpdateMissionRequest {
  name?: string;
  description?: string;
  status?: 'idle' | 'paused' | 'archived';
  trigger?: MissionTrigger;
  prompt?: string;
  capabilities?: string[];
  delivery?: MissionDelivery;
  dependencies?: string[];
}
