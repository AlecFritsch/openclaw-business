"use client";

import { Clock, RefreshCw, MessageSquare, Webhook, Link2, Crosshair, Zap } from "lucide-react";
import { timeAgo } from "@/lib/time";
import type { Mission, MissionTriggerType, MissionStatus } from "@openclaw-business/shared";

const TRIGGER_ICON: Record<MissionTriggerType, typeof Clock> = {
  schedule: Clock,
  interval: RefreshCw,
  channel_message: MessageSquare,
  webhook: Webhook,
  mission_complete: Link2,
  manual: Crosshair,
  event: Zap,
};

const STATUS_DOT: Record<MissionStatus, string> = {
  idle: "bg-emerald-500",
  running: "bg-blue-500 animate-pulse",
  paused: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  archived: "bg-gray-400 dark:bg-gray-600",
};

function triggerLabel(m: Mission): string {
  const triggers = m.triggerConfigs;
  if (triggers && triggers.length > 1) return `${triggers.length} triggers`;
  const cfg = m.trigger.config || {};
  switch (m.trigger.type) {
    case "schedule": return cfg.expr ? String(cfg.expr) : "Scheduled";
    case "interval": {
      const ms = Number(cfg.everyMs) || 0;
      return ms >= 3600000 ? `Every ${Math.round(ms / 3600000)}h` : `Every ${Math.round(ms / 60000)}min`;
    }
    case "channel_message": return `On message${cfg.channel ? ` in ${cfg.channel}` : ""}`;
    case "webhook": return "Webhook";
    case "mission_complete": return "After mission";
    case "manual": return "Manual";
    case "event": return cfg.event ? String(cfg.event) : "Event";
    default: return m.trigger.type;
  }
}

interface Props {
  mission: Mission;
  onClick: () => void;
}

export function EngineMissionCard({ mission, onClick }: Props) {
  const Icon = TRIGGER_ICON[mission.trigger.type] || Zap;

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-xl border border-border/50 bg-card/50 hover:border-purple-300/40 hover:bg-purple-500/5 transition-all group border-l-2 border-l-purple-400/60"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-1 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[mission.status] || "bg-gray-400"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium truncate">{mission.name}</p>
            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 font-medium">engine</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" strokeWidth={2} />
            <span className="text-xs text-muted-foreground truncate">{triggerLabel(mission)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {mission.stats.lastRunAt && (
            <span className="text-xs text-muted-foreground/40">{timeAgo(mission.stats.lastRunAt)}</span>
          )}
          {mission.stats.totalRuns > 0 && (
            <p className="text-xs text-muted-foreground/30 mt-0.5">{mission.stats.totalRuns} runs</p>
          )}
        </div>
      </div>
    </button>
  );
}
