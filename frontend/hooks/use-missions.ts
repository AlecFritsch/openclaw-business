"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { useEventStream } from "@/lib/use-event-stream";
import type { Mission, MissionType, CronJob, CronJobSchedule, Workflow, WorkflowRun } from "@/types/missions";

// ── Cron → Mission normalizer ───────────────────────────────

function parseCronSchedule(schedule: CronJobSchedule | string): { type: MissionType; trigger: string; triggerLabel: string } {
  if (typeof schedule === "string") {
    return { type: "cron", trigger: schedule, triggerLabel: describeCron(schedule) };
  }
  switch (schedule.kind) {
    case "at":
      return { type: "one-shot", trigger: schedule.at || "", triggerLabel: schedule.at ? `Once at ${new Date(schedule.at).toLocaleString()}` : "One-shot" };
    case "every":
      return { type: "interval", trigger: `${schedule.everyMs}ms`, triggerLabel: formatInterval(schedule.everyMs || 0) };
    case "cron":
      return { type: "cron", trigger: schedule.expr || "", triggerLabel: describeCron(schedule.expr || "") };
    default:
      return { type: "cron", trigger: "", triggerLabel: "Scheduled" };
  }
}

function describeCron(expr: string): string {
  if (!expr) return "Scheduled";
  const p = expr.split(" ");
  if (p.length < 5) return expr;
  const [min, hour, , , dow] = p;
  if (min === "0" && hour !== "*" && dow === "*") return `Daily ${hour}:00`;
  if (min === "0" && hour !== "*" && dow === "1-5") return `Weekdays ${hour}:00`;
  if (min === "0" && hour !== "*" && dow === "1") return `Mondays ${hour}:00`;
  if (expr.startsWith("*/")) return `Every ${p[0].replace("*/", "")}min`;
  return expr;
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)}min`;
  return `Every ${Math.round(ms / 3_600_000)}h`;
}

function cronToMission(job: CronJob): Mission {
  // Handle legacy flat fields (every, at) alongside schedule object
  const legacyEvery = (job as any).every as string | undefined;
  const legacyAt = (job as any).at as string | undefined;

  let parsed: { type: MissionType; trigger: string; triggerLabel: string };
  if (job.schedule) {
    parsed = parseCronSchedule(job.schedule);
  } else if (legacyEvery) {
    parsed = { type: "interval", trigger: legacyEvery, triggerLabel: `Every ${legacyEvery}` };
  } else if (legacyAt) {
    parsed = { type: "one-shot", trigger: legacyAt, triggerLabel: `Once at ${new Date(legacyAt).toLocaleString()}` };
  } else {
    parsed = { type: "cron", trigger: "", triggerLabel: "Scheduled" };
  }

  return {
    id: `cron:${job.jobId}`,
    name: job.name || "Unnamed",
    ...parsed,
    output: job.delivery?.mode === "webhook" ? "→ webhook" : job.delivery?.mode === "announce" ? "→ announce" : undefined,
    status: job.enabled ? "active" : "paused",
    enabled: job.enabled,
    lastRun: job.lastRun || job.lastRunAt,
    totalRuns: job.totalRuns,
    source: "cron",
    sourceId: job.jobId,
    sourceData: job,
  };
}

function flowToMission(flow: Workflow): Mission {
  return {
    id: `flow:${flow._id}`,
    name: flow.name,
    type: "flow",
    trigger: "event-driven",
    triggerLabel: flow.description || `${flow.steps?.length || 0} steps`,
    status: (flow.status === "active" || flow.status === "paused" || flow.status === "pending") ? flow.status : "pending",
    enabled: flow.status === "active",
    lastRun: flow.lastRun,
    totalRuns: flow.totalRuns,
    source: "flow",
    sourceId: flow._id,
    sourceData: flow,
  };
}

// ── Hook ────────────────────────────────────────────────────

interface UseMissionsOptions {
  agentId: string;
  cronJobs: CronJob[];
  onCronReload?: () => void;
}

interface UseMissionsReturn {
  missions: Mission[];
  flows: Workflow[];
  loading: boolean;
  error: string | null;
  reloadFlows: () => Promise<void>;
  // Run detail
  runs: WorkflowRun[];
  loadRuns: (flowId: string) => Promise<void>;
  runsLoading: boolean;
}

export function useMissions({ agentId, cronJobs, onCronReload }: UseMissionsOptions): UseMissionsReturn {
  const { getToken } = useAuth();
  const [flows, setFlows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const reloadFlows = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token || !agentId) return;
      const data = await apiClient.getAgentWorkflows(token, agentId);
      setFlows((data.workflows || []) as Workflow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => {
    if (agentId) { setLoading(true); reloadFlows(); }
  }, [agentId, reloadFlows]);

  // Live updates — reload on workflow events AND agent tool completions
  // (agent uses cron/lobster tools → "agent" event with tool results)
  useEventStream({
    filter: (e) => e.agentId === agentId && (
      e.event === "workflow:update" || e.event === "lobster:complete" ||
      e.event === "lobster:started" || e.event === "cron" || e.event === "agent"
    ),
    onEvent: (e) => {
      // For "agent" events, only reload if it looks like a cron/lobster tool call completed
      if (e.event === "agent") {
        const p = e.payload as any;
        const toolName = p?.tool?.name || p?.toolName || p?.name || "";
        if (!toolName.startsWith("cron") && !toolName.startsWith("lobster")) return;
      }
      reloadFlows();
      onCronReload?.();
    },
    enabled: !!agentId,
  });

  const missions = useMemo<Mission[]>(() => [
    ...(cronJobs || []).map(cronToMission),
    ...flows.map(flowToMission),
  ], [cronJobs, flows]);

  const loadRuns = useCallback(async (flowId: string) => {
    try {
      setRunsLoading(true);
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getWorkflowRuns(token, agentId, flowId, 5);
      setRuns((data.runs || []) as WorkflowRun[]);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [agentId, getToken]);

  return { missions, flows, loading, error, reloadFlows, runs, loadRuns, runsLoading };
}
