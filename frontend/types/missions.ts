// ── Mission types ───────────────────────────────────────────
// Unified view model for cron jobs + Lobster workflows

export type MissionType = "cron" | "flow" | "interval" | "one-shot";
export type MissionStatus = "active" | "paused" | "pending" | "completed" | "failed";

export interface Mission {
  id: string;
  name: string;
  type: MissionType;
  trigger: string;        // raw: "0 9 * * *" or "30m" or ISO date
  triggerLabel: string;    // human: "Daily 9:00" or "Every 30min"
  output?: string;
  status: MissionStatus;
  enabled: boolean;
  lastRun?: string;
  totalRuns?: number;
  source: "cron" | "flow";
  sourceId: string;        // jobId or workflow _id
  sourceData: CronJob | Workflow;
}

// ── OpenClaw cron job (from gateway cron.list RPC) ──────────

export interface CronJobSchedule {
  kind: "at" | "every" | "cron";
  at?: string;             // ISO 8601
  everyMs?: number;
  expr?: string;           // cron expression
  tz?: string;
}

export interface CronJob {
  jobId: string;
  name: string;
  schedule: CronJobSchedule | string; // string for legacy compat
  enabled: boolean;
  description?: string;
  message?: string;
  agentId?: string;
  sessionTarget?: "main" | "isolated";
  delivery?: { mode: "announce" | "webhook" | "none"; url?: string };
  deleteAfterRun?: boolean;
  lastRun?: string;
  lastRunAt?: string;
  totalRuns?: number;
  createdAt?: string;
}

// ── Lobster workflow ────────────────────────────────────────

export type StepType = "llm" | "tool" | "condition" | "approval" | "http" | "wait" | "transform";
export type RunStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_approval";

export interface WorkflowStep {
  id: string;
  type: StepType;
  name?: string;
  label?: string;
  command?: string;
  config?: Record<string, any>;
  condition?: string;
  onFailure?: "stop" | "skip" | "retry";
}

export interface Workflow {
  _id: string;
  name: string;
  description?: string;
  status: "active" | "paused" | "pending" | "draft";
  steps: WorkflowStep[];
  lastRun?: string;
  totalRuns?: number;
  createdAt?: string;
}

export interface WorkflowRun {
  _id: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  steps?: WorkflowRunStep[];
}

export interface WorkflowRunStep {
  stepId: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

// ── Sub-Agent ──────────────────────────────────────────────

export interface SubAgent {
  subAgentId: string;
  name: string;
  isDefault: boolean;
  overrides?: {
    model?: string;
    toolProfile?: string;
    identityName?: string;
  };
}
