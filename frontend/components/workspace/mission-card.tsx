"use client";

import { Clock, Zap, RefreshCw, Calendar } from "lucide-react";
import { timeAgo } from "@/lib/time";
import type { Mission, MissionType } from "@/types/missions";

const TYPE_ICON: Record<MissionType, typeof Clock> = {
  cron: Clock,
  flow: Zap,
  interval: RefreshCw,
  "one-shot": Calendar,
};

interface MissionCardProps {
  mission: Mission;
  onClick: () => void;
  selected?: boolean;
}

export function MissionCard({ mission, onClick, selected }: MissionCardProps) {
  const Icon = TYPE_ICON[mission.type];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all group border-l-2 ${
        selected
          ? "border-foreground/20 bg-muted/40 shadow-sm border-l-foreground/30"
          : "border-border/50 bg-card/50 hover:border-border/80 hover:bg-muted/30 border-l-border"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-1 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${
            mission.enabled && mission.status === "active" ? "bg-emerald-500" :
            mission.status === "pending" ? "bg-amber-500" :
            "bg-gray-400 dark:bg-gray-600"
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{mission.name}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <Icon className="w-3 h-3 text-muted-foreground/50 shrink-0" strokeWidth={2} />
            <span className="text-xs text-muted-foreground truncate">{mission.triggerLabel}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {mission.lastRun && (
            <span className="text-xs text-muted-foreground/40">{timeAgo(mission.lastRun)}</span>
          )}
          {mission.output && (
            <p className="text-xs text-muted-foreground/30 mt-0.5">{mission.output}</p>
          )}
        </div>
      </div>
    </button>
  );
}
