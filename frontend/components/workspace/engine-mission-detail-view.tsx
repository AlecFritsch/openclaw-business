"use client";

import { useState } from "react";
import { ArrowLeft, Play, Pause, Trash2, RotateCcw, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { timeAgo } from "@/lib/time";
import { showToast } from "@/components/toast";
import type { Mission, MissionRun, MissionStatus, MissionRunStatus } from "@openclaw-business/shared";

/** Parse prompt into [TRIGGER: id] blocks (like builder preview) */
function parseTriggerBlocks(prompt: string): Array<{ id: string; block: string; steps: string[] }> {
  const re = /\[TRIGGER:\s*([^\]]+)\]([\s\S]*?)(?=\[TRIGGER:|$)/gi;
  const matches = [...prompt.matchAll(re)];
  if (matches.length === 0) {
    const steps = prompt.split(/\n/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
    return [{ id: 'default', block: prompt, steps }];
  }
  return matches.map(m => {
    const id = m[1].trim();
    const block = m[2].trim();
    const steps = block.split(/\n/).map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
    return { id, block, steps };
  });
}

function formatScheduleDisplay(schedule?: string, every?: string, tz?: string): string {
  const tzSuffix = tz ? ` (${tz})` : '';
  if (every) {
    const m = every.match(/^(\d+)\s*(m|min|h|hr)?$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const u = (m[2] || 'm').toLowerCase();
      if (u.startsWith('h')) return `Every ${n}h` + tzSuffix;
      if (u.startsWith('m')) return `Every ${n}min` + tzSuffix;
    }
    return every + tzSuffix;
  }
  if (schedule) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length >= 5) {
      const [, hour, , , dow] = parts;
      const h = parseInt(hour, 10);
      if (dow === '*') return `Daily at ${h}:00` + tzSuffix;
      if (dow === '1-5') return `Weekdays at ${h}:00` + tzSuffix;
      if (dow === '5') return `Friday at ${h}:00` + tzSuffix;
    }
  }
  return (schedule || every || '') + tzSuffix;
}

interface Props {
  mission: Mission;
  runs: MissionRun[];
  runsLoading: boolean;
  onBack: () => void;
  onRun: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onDelete: () => Promise<void>;
  onReload: () => void;
}

const STATUS_BADGE: Record<MissionStatus, { label: string; cls: string }> = {
  idle: { label: "Idle", cls: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" },
  running: { label: "Running", cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
  paused: { label: "Paused", cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
  completed: { label: "Completed", cls: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" },
  failed: { label: "Failed", cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" },
  archived: { label: "Archived", cls: "bg-gray-100 dark:bg-gray-800 text-muted-foreground" },
};

const RUN_STATUS_COLOR: Record<MissionRunStatus, string> = {
  running: "text-blue-500",
  completed: "text-emerald-500",
  failed: "text-red-500",
  cancelled: "text-muted-foreground",
};

export function EngineMissionDetailView({ mission, runs, runsLoading, onBack, onRun, onPause, onResume, onDelete, onReload }: Props) {
  const t = useTranslations("workspace.missionsPanel");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const badge = STATUS_BADGE[mission.status] || STATUS_BADGE.idle;

  const handleAction = async (action: () => Promise<void>, label: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await action();
      showToast(label, "success");
      onReload();
    } catch { showToast(t("failed"), "error"); }
    finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="h-10 flex items-center gap-2 px-3 border-b border-border/50 shrink-0">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium truncate flex-1">{mission.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Info */}
        <div className="px-3 py-3 border-b border-border/30 space-y-2">
          {mission.description && (
            <p className="text-xs text-muted-foreground">{mission.description}</p>
          )}
          <Row label="Trigger" value={describeTrigger(mission)} />
          {mission.delivery?.channel && (
            <Row label="Delivery" value={`${mission.delivery.channel}${mission.delivery.target ? ` ${mission.delivery.target}` : ""}`} />
          )}
          {mission.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mission.capabilities.map(c => (
                <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{c}</span>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="px-3 py-2.5 border-b border-border/30 grid grid-cols-3 gap-2">
          <Stat label="Runs" value={String(mission.stats.totalRuns)} />
          <Stat label="Success" value={`${Math.round(mission.stats.successRate * 100)}%`} />
          <Stat label="Avg" value={mission.stats.avgDurationMs > 0 ? `${Math.round(mission.stats.avgDurationMs / 1000)}s` : "—"} />
        </div>

        {/* Autonomous Prompt — same structure as builder preview: one card, trigger sections with border-t */}
        <div className="px-3 py-3 border-b border-border/30">
          <p className="text-xs text-muted-foreground/50 uppercase tracking-wider mb-3">Autonomous Prompt</p>
          <div className="rounded-xl border border-border/80 bg-muted/20 overflow-hidden">
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="text-xs font-medium flex-1 min-w-0 truncate">{mission.name}</span>
              <Clock size={12} className="text-muted-foreground shrink-0" aria-hidden />
            </div>
            {(() => {
              const blocks = parseTriggerBlocks(mission.prompt);
              const triggerConfigs = mission.triggerConfigs;
              return blocks.map(({ id, steps }) => {
                const cfg = triggerConfigs?.find(tc => tc.id === id);
                const scheduleStr = formatScheduleDisplay(cfg?.schedule, cfg?.every, cfg?.tz) || (mission.trigger.type === 'manual' ? 'Manual trigger' : describeTrigger(mission));
                return (
                  <div key={id} className="px-3 pb-2.5 pt-0 first:pt-0">
                    <div className="border-t border-border/50 pt-2 space-y-1.5 first:border-t-0 first:pt-0">
                      {(cfg?.schedule || cfg?.every || (id === 'default' && mission.trigger.type === 'manual')) && (
                        <p className="text-xs text-muted-foreground mb-1">{scheduleStr}</p>
                      )}
                      {steps.map((step, si) => (
                        <div key={si} className="flex items-start gap-2">
                          <span className="text-xs text-muted-foreground font-mono w-3 shrink-0 text-right pt-px">{si + 1}</span>
                          <span className="text-xs text-foreground/80 leading-snug">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Run history */}
        <div className="border-b border-border/30">
          <p className="px-3 py-2 text-xs text-muted-foreground/50 uppercase tracking-wider">{t("recentRuns")}</p>
          {runsLoading && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground/40">Loading...</div>
          )}
          {!runsLoading && runs.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground/30">No runs yet</div>
          )}
          {!runsLoading && runs.map(r => (
            <details key={r._id} className="border-t border-border/10">
              <summary className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-muted/10">
                <span className={`text-xs font-medium ${RUN_STATUS_COLOR[r.status] || "text-muted-foreground"}`}>{r.status}</span>
                <div className="flex items-center gap-2">
                  {r.durationMs && <span className="text-xs text-muted-foreground/30">{Math.round(r.durationMs / 1000)}s</span>}
                  <span className="text-xs text-muted-foreground/30">{timeAgo(r.startedAt)}</span>
                </div>
              </summary>
              {(r.output || r.error) && (
                <div className="px-3 pb-2">
                  <pre className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2 overflow-x-auto max-h-32 whitespace-pre-wrap">
                    {r.error || r.output}
                  </pre>
                </div>
              )}
            </details>
          ))}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-3 py-2 border-t border-border/40 shrink-0 flex items-center justify-between">
        <button
          onClick={() => handleAction(onDelete, "Mission deleted")}
          disabled={isSubmitting}
          className="text-xs px-2 py-1 rounded-lg text-red-500/70 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors flex items-center gap-1 disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" />
        </button>
        <div className="flex items-center gap-1.5">
          {mission.status === "paused" ? (
            <button onClick={() => handleAction(onResume, "Mission resumed")} disabled={isSubmitting} className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50">
              <RotateCcw className="w-3 h-3" /> Resume
            </button>
          ) : mission.status !== "archived" && (
            <button onClick={() => handleAction(onPause, "Mission paused")} disabled={isSubmitting} className="text-xs px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50">
              <Pause className="w-3 h-3" /> Pause
            </button>
          )}
          <button
            onClick={() => handleAction(onRun, t("missionTriggered"))}
            disabled={mission.status === "running" || mission.status === "archived" || isSubmitting}
            className="text-xs px-2.5 py-1 rounded-lg bg-foreground text-primary-foreground disabled:opacity-30 flex items-center gap-1"
          >
            <Play className="w-3 h-3" /> Run
          </button>
        </div>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="uppercase tracking-wider text-xs text-muted-foreground/50">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium">{value}</p>
      <p className="text-xs text-muted-foreground/40">{label}</p>
    </div>
  );
}

function describeTrigger(m: Mission): string {
  const cfg = m.trigger.config || {};
  switch (m.trigger.type) {
    case "schedule": return cfg.expr ? `Cron: ${cfg.expr}` : "Scheduled";
    case "interval": {
      const ms = Number(cfg.everyMs) || 0;
      return ms >= 3600000 ? `Every ${Math.round(ms / 3600000)}h` : `Every ${Math.round(ms / 60000)}min`;
    }
    case "channel_message": return `On message${cfg.channel ? ` in ${cfg.channel}` : ""}${cfg.filter ? ` matching "${cfg.filter}"` : ""}`;
    case "webhook": return "POST webhook";
    case "mission_complete": return `After mission ${cfg.missionId || ""}`;
    case "manual": return "Manual trigger";
    case "event": return `Event: ${cfg.event || "any"}`;
    default: return m.trigger.type;
  }
}
