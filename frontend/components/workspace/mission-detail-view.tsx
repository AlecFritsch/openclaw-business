"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Play, Pause, ArrowDown } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { timeAgo } from "@/lib/time";
import { showToast } from "@/components/toast";
import type { Mission, Workflow, WorkflowStep, WorkflowRun, WorkflowRunStep } from "@/types/missions";

interface MissionDetailViewProps {
  mission: Mission;
  agentId: string;
  runs: WorkflowRun[];
  runsLoading: boolean;
  onBack: () => void;
  onReloadFlows: () => void;
  onReloadRuns: (flowId: string) => void;
}

export function MissionDetailView({ mission, agentId, runs, runsLoading, onBack, onReloadFlows, onReloadRuns }: MissionDetailViewProps) {
  const { getToken } = useAuth();
  const t = useTranslations("workspace.missionsPanel");
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Poll runs while a flow run is active
  useEffect(() => {
    if (mission.source !== "flow") return;
    const hasActive = runs.some(r => r.status === "running" || r.status === "waiting_approval");
    if (!hasActive) return;
    const interval = setInterval(() => onReloadRuns(mission.sourceId), 2000);
    return () => clearInterval(interval);
  }, [runs, mission.source, mission.sourceId, onReloadRuns]);

  const handleRunFlow = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.runAgentWorkflow(token, agentId, mission.sourceId);
      showToast(t("missionTriggered"), "success");
      setTimeout(() => onReloadRuns(mission.sourceId), 1000);
    } catch { showToast(t("failed"), "error"); }
  }, [agentId, mission.sourceId, getToken, t, onReloadRuns]);

  const handleToggleFlow = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const flow = mission.sourceData as Workflow;
      await apiClient.updateAgentWorkflow(token, agentId, mission.sourceId, {
        status: flow.status === "active" ? "paused" : "active",
      });
      onReloadFlows();
    } catch { showToast(t("failed"), "error"); }
  }, [agentId, mission, getToken, t, onReloadFlows]);

  const handleApprove = useCallback(async (runId: string, approved: boolean) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.approveWorkflowRun(token, agentId, mission.sourceId, runId, approved);
      showToast(approved ? t("approved") : t("rejected"), "success");
      onReloadRuns(mission.sourceId);
    } catch { showToast(t("failed"), "error"); }
  }, [agentId, mission.sourceId, getToken, t, onReloadRuns]);

  const flow = mission.source === "flow" ? mission.sourceData as Workflow : null;
  const pendingRun = runs.find(r => r.status === "waiting_approval");
  const activeRun = runs.find(r => r.status === "running" || r.status === "waiting_approval");

  return (
    <>
      {/* Header */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-border/50 shrink-0">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium truncate flex-1">{mission.name}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${mission.enabled ? "bg-emerald-500" : "bg-gray-400"}`} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Mission info */}
        <div className="px-3 py-3 border-b border-border/30 space-y-1.5">
          <InfoRow label={t("trigger")} value={mission.triggerLabel} />
          {mission.output && <InfoRow label={t("output")} value={mission.output} />}
          {mission.totalRuns !== undefined && (
            <div className="text-xs text-muted-foreground/40">{mission.totalRuns} {t("runs")}</div>
          )}
        </div>

        {/* Flow: approval banner */}
        {pendingRun && (
          <div className="px-3 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200/40">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">{t("awaitingApproval")}</p>
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => handleApprove(pendingRun._id, true)} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium">{t("approve")}</button>
              <button onClick={() => handleApprove(pendingRun._id, false)} className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-red-500">{t("reject")}</button>
            </div>
          </div>
        )}

        {/* Flow: steps */}
        {flow?.steps?.map((step, i) => {
          const isExpanded = expandedStep === i;
          const stepRun = activeRun?.steps?.find(s => s.stepId === step.id);
          return (
            <div key={step.id}>
              <button
                onClick={() => setExpandedStep(isExpanded ? null : i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 border-b transition-colors ${isExpanded ? "border-foreground/10 bg-muted/30" : "border-border/20 hover:bg-muted/15"}`}
              >
                <StepIndicator index={i} status={stepRun?.status} />
                <span className="text-xs font-medium flex-1 truncate">{describeStep(step)}</span>
              </button>
              {isExpanded && (
                <div className="px-3 py-2 bg-muted/20 border-b border-border/20 pl-11">
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wider">{t("command")}</span>
                  <p className="text-xs font-mono text-foreground/70 mt-0.5 break-all">
                    {step.command || step.config?.prompt?.slice(0, 120) || "—"}
                  </p>
                </div>
              )}
              {i < (flow.steps.length - 1) && !isExpanded && (
                <div className="flex justify-center py-0.5 border-b border-border/20">
                  <ArrowDown className="w-3 h-3 text-muted-foreground/25" strokeWidth={2} />
                </div>
              )}
            </div>
          );
        })}

        {/* Flow: run history */}
        {runs.length > 0 && (
          <div className="border-t border-border/40 mt-1">
            <p className="px-3 py-2 text-xs text-muted-foreground/50 uppercase tracking-wider">{t("recentRuns")}</p>
            {runs.map(r => (
              <div key={r._id} className="px-3 py-2 border-b border-border/10 flex items-center justify-between">
                <RunStatusBadge status={r.status} />
                <span className="text-xs text-muted-foreground/30">{r.startedAt ? timeAgo(r.startedAt) : "—"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Cron: schedule details */}
        {mission.source === "cron" && (
          <div className="px-3 py-3 space-y-2">
            <div>
              <span className="text-xs text-muted-foreground/50 uppercase tracking-wider">{t("schedule")}</span>
              <p className="text-xs font-mono mt-0.5">{mission.trigger}</p>
            </div>
            {(mission.sourceData as any).message && (
              <div>
                <span className="text-xs text-muted-foreground/50 uppercase tracking-wider">{t("message")}</span>
                <p className="text-xs mt-0.5 text-muted-foreground">{(mission.sourceData as any).message}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: flow actions */}
      {mission.source === "flow" && (
        <div className="px-3 py-2 border-t border-border/40 shrink-0 flex items-center justify-end gap-1.5">
          <button onClick={handleRunFlow} disabled={!mission.enabled} className="text-xs px-2.5 py-1 rounded-lg bg-foreground text-primary-foreground disabled:opacity-30 flex items-center gap-1">
            <Play className="w-3 h-3" /> {t("run")}
          </button>
          <button onClick={handleToggleFlow} className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Pause className="w-3 h-3" /> {mission.enabled ? t("pause") : t("resume")}
          </button>
        </div>
      )}
    </>
  );
}

// ── Small sub-components ────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="uppercase tracking-wider text-xs text-muted-foreground/50">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StepIndicator({ index, status }: { index: number; status?: string }) {
  return (
    <span className="w-5 shrink-0 flex justify-center">
      {status === "running" ? <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-blue-400/30 border-t-blue-500 animate-spin" />
        : status === "completed" ? <span className="text-xs text-emerald-500">✓</span>
        : status === "failed" ? <span className="text-xs text-red-500">✗</span>
        : <span className="text-xs text-muted-foreground/40 tabular-nums">{String(index + 1).padStart(2, "0")}</span>}
    </span>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const color = status === "completed" ? "text-emerald-500"
    : status === "failed" ? "text-red-500"
    : status === "running" ? "text-blue-500"
    : "text-muted-foreground";
  return <span className={`text-xs font-medium ${color}`}>{status}</span>;
}

function describeStep(step: WorkflowStep): string {
  if (step.name) return step.name;
  if (step.label) return step.label;
  const cmd = step.command?.trim() || "";
  if (cmd.startsWith("web_fetch")) return "Fetch webpage";
  if (cmd.startsWith("web_search")) return "Search the web";
  if (cmd.startsWith("llm")) return "AI analysis";
  if (cmd.startsWith("browser")) return "Browser action";
  return step.id?.replace(/[-_]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Step";
}
