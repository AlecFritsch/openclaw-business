"use client";

import { ChevronLeft } from "lucide-react";
import { ChannelIcon } from "@/components/channel-icon";
import { useTranslations } from "next-intl";
import { timeAgo } from "@/lib/time";

interface SessionInfo {
  key: string;
  agentId: string;
  channel?: string;
  peer?: string;
  messageCount: number;
  lastActivityAt?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  kind?: string;
}

interface SessionSidebarProps {
  sessions: SessionInfo[];
  selectedSession: string | null;
  onSelectSession: (key: string) => void;
  health: any;
  stats: any;
  isOpen: boolean;
  onToggle: () => void;
}

function getSessionLabel(session: SessionInfo): string {
  if (session.channel) {
    const channelName = session.channel.charAt(0).toUpperCase() + session.channel.slice(1);
    return session.peer ? `${channelName} — ${session.peer}` : channelName;
  }
  const friendly = session.displayName || session.label || session.derivedTitle;
  if (friendly && friendly.trim()) return friendly.trim();

  const lastPart = session.key.split(":").pop() || session.key;
  if (lastPart === "main") return "Workspace Chat";
  if (lastPart === "operator") return "Operator";
  if (session.key.includes("subagent:")) {
    const taskName = lastPart.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return taskName || lastPart;
  }
  return lastPart;
}

type DateGroup = "today" | "yesterday" | "week" | "older";
type SessionType = "direct" | "channel" | "task";

function getDateGroup(dateStr?: string): DateGroup {
  if (!dateStr) return "older";
  const now = new Date();
  const then = new Date(dateStr);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);

  if (then >= todayStart) return "today";
  if (then >= yesterdayStart) return "yesterday";
  if (then >= weekStart) return "week";
  return "older";
}

function getSessionType(session: SessionInfo): SessionType {
  if (session.channel) return "channel";
  if (session.key.includes("subagent:")) return "task";
  return "direct";
}

const DATE_GROUP_LABELS: Record<DateGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  older: "Older",
};

const DATE_GROUP_ORDER: DateGroup[] = ["today", "yesterday", "week", "older"];
const SESSION_TYPE_ORDER: SessionType[] = ["direct", "channel", "task"];

function deriveStatus(health: any, stats: any): { color: string; label: string } {
  const isOk = health?.status === "ok" || health?.ok === true;
  const isDegraded = health?.status === "degraded" || health?.ok === false;
  if (isOk) return { color: "bg-emerald-500", label: "healthy" };
  if (isDegraded) return { color: "bg-amber-500", label: "degraded" };
  if (stats?.stats) return { color: "bg-amber-500", label: "degraded" };
  if (health) return { color: "bg-red-500", label: "unhealthy" };
  return { color: "bg-muted-foreground/40", label: "unknown" };
}

export function SessionSidebar({
  sessions,
  selectedSession,
  onSelectSession,
  health,
  stats,
  isOpen,
  onToggle,
}: SessionSidebarProps) {
  const t = useTranslations("workspace.sessionSidebar");
  const status = deriveStatus(health, stats);

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-10 h-full flex flex-col items-center justify-center py-4 hover:bg-muted/50 transition-colors shrink-0 group border-r border-border/40"
        title={t("openPanel")}
      >
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground whitespace-nowrap -rotate-90 origin-center">{t("chats")}</span>
      </button>
    );
  }

  // Group sessions
  const byType = new Map<SessionType, Map<DateGroup, SessionInfo[]>>();
  for (const type of SESSION_TYPE_ORDER) {
    byType.set(type, new Map());
    for (const dg of DATE_GROUP_ORDER) byType.get(type)!.set(dg, []);
  }
  for (const s of sessions) {
    byType.get(getSessionType(s))!.get(getDateGroup(s.lastActivityAt))!.push(s);
  }

  return (
    <div className="w-56 flex flex-col shrink-0 h-full bg-card/50">
      {/* Header */}
      <div className="h-10 px-3 flex items-center gap-2 shrink-0 border-b border-border/40">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${status.color} ${status.label === "healthy" ? "animate-ping" : ""}`} />
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${status.color}`} />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{t(status.label)}</span>

        {stats?.stats && (
          <div className="flex items-center gap-1.5 ml-auto px-1.5 py-0.5 rounded-md bg-muted/60">
            <span className="text-xs tabular-nums text-muted-foreground font-mono">{stats.stats.cpuUsage}%</span>
            <span className="w-px h-2 bg-border" />
            <span className="text-xs tabular-nums text-muted-foreground font-mono">{stats.stats.memoryUsage}M</span>
          </div>
        )}

        <button
          onClick={onToggle}
          className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
          title={t("closePanel")}
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="px-3 py-8 text-center rounded-lg bg-muted/30 border border-dashed border-border/60">
            <p className="text-xs text-muted-foreground">{t("noSessions")}</p>
          </div>
        ) : (
          SESSION_TYPE_ORDER.flatMap((sessionType) =>
            DATE_GROUP_ORDER.map((dateGroup) => {
              const items = byType.get(sessionType)!.get(dateGroup)!;
              if (items.length === 0) return null;
              const typeLabel = t(`group.${sessionType}` as any);
              const dateLabel = DATE_GROUP_LABELS[dateGroup];
              return (
                <div key={`${sessionType}-${dateGroup}`} className="mt-3 first:mt-0">
                  <div className="px-2 py-1 mb-0.5">
                    <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
                      {typeLabel} · {dateLabel}
                    </span>
                  </div>
                  <div className="space-y-px">
                    {items.map((session) => {
                      const label = getSessionLabel(session);
                      const isSelected = selectedSession === session.key;
                      return (
                        <button
                          key={session.key}
                          onClick={() => onSelectSession(session.key)}
                          className={`w-full text-left px-2.5 py-2 rounded-lg transition-all duration-100 group flex items-start gap-2 ${
                            isSelected
                              ? "bg-primary/8 text-foreground ring-1 ring-primary/15"
                              : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {session.channel && (
                            <span className={`shrink-0 mt-0.5 transition-opacity ${isSelected ? "opacity-100" : "opacity-40 group-hover:opacity-70"}`}>
                              <ChannelIcon channel={session.channel} size={13} />
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate block">{label}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs tabular-nums text-muted-foreground/70">
                                {session.messageCount} {t("messages")}
                              </span>
                              {session.lastActivityAt && (
                                <>
                                  <span className="text-muted-foreground/30">·</span>
                                  <span className="text-xs tabular-nums text-muted-foreground/70">
                                    {timeAgo(session.lastActivityAt)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ).filter(Boolean)
        )}
      </div>
    </div>
  );
}
