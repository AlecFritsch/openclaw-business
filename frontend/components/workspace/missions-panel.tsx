"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMissions } from "@/hooks/use-missions";
import { useMissionEngine } from "@/hooks/use-mission-engine";
import { MissionCard } from "./mission-card";
import { EngineMissionCard } from "./engine-mission-card";
import { MissionDetailView } from "./mission-detail-view";
import { EngineMissionDetailView } from "./engine-mission-detail-view";
import { ErrorBoundary } from "@/components/error-boundary";
import type { Mission as LegacyMission, CronJob, SubAgent } from "@/types/missions";

// ── Props ───────────────────────────────────────────────────

interface MissionsPanelProps {
  agentId: string;
  isOpen: boolean;
  onToggle: () => void;
  cronJobs?: CronJob[];
  onCronReload?: () => void;
  subAgents?: SubAgent[];
  onSubAgentsReload?: () => void;
}

const MIN_WIDTH = 380;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 440;

type Selection = { kind: "legacy"; id: string } | { kind: "engine"; id: string } | null;

// ── Component ───────────────────────────────────────────────

export function MissionsPanel({
  agentId,
  isOpen,
  onToggle,
  cronJobs = [],
  onCronReload,
  subAgents = [],
}: MissionsPanelProps) {
  const t = useTranslations("workspace.missionsPanel");
  const legacy = useMissions({ agentId, cronJobs, onCronReload });
  const engine = useMissionEngine(agentId);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [selection, setSelection] = useState<Selection>(null);
  const [agentsCollapsed, setAgentsCollapsed] = useState(true);

  // ── Resize ──
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + (startX.current - e.clientX))));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ── Handlers ──
  const handleSelectLegacy = useCallback((m: LegacyMission) => {
    setSelection({ kind: "legacy", id: m.id });
    if (m.source === "flow") legacy.loadRuns(m.sourceId);
  }, [legacy]);

  const handleSelectEngine = useCallback((id: string) => {
    setSelection({ kind: "engine", id });
    engine.selectMission(id);
  }, [engine]);

  const handleBack = useCallback(() => {
    setSelection(null);
    engine.clearSelection();
  }, [engine]);

  const handleNewMission = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-mission-creator"));
  }, []);

  // ── Collapsed ──
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-10 h-full flex flex-col items-center justify-center py-4 hover:bg-muted/40 transition-colors shrink-0 group border-l border-border/60"
        title={t("openPanel")}
      >
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground whitespace-nowrap -rotate-90 origin-center">{t("missions")}</span>
      </button>
    );
  }

  // ── Detail view ──
  if (selection?.kind === "engine" && engine.selectedMission) {
    return (
      <div className="h-full flex flex-col shrink-0 relative" style={{ width }}>
        <ResizeHandle onMouseDown={onMouseDown} />
        <EngineMissionDetailView
          mission={engine.selectedMission}
          runs={engine.selectedRuns}
          runsLoading={engine.runsLoading}
          onBack={handleBack}
          onRun={() => engine.runMission(engine.selectedMission!._id)}
          onPause={() => engine.pauseMission(engine.selectedMission!._id)}
          onResume={() => engine.resumeMission(engine.selectedMission!._id)}
          onDelete={() => { engine.deleteMission(engine.selectedMission!._id); handleBack(); }}
          onReload={() => engine.selectMission(engine.selectedMission!._id)}
        />
      </div>
    );
  }

  if (selection?.kind === "legacy") {
    const selected = legacy.missions.find(m => m.id === selection.id);
    if (selected) {
      return (
        <div className="h-full flex flex-col shrink-0 relative" style={{ width }}>
          <ResizeHandle onMouseDown={onMouseDown} />
          <MissionDetailView
            mission={selected}
            agentId={agentId}
            runs={legacy.runs}
            runsLoading={legacy.runsLoading}
            onBack={handleBack}
            onReloadFlows={legacy.reloadFlows}
            onReloadRuns={legacy.loadRuns}
          />
        </div>
      );
    }
  }

  const loading = legacy.loading || engine.loading;
  const hasAny = legacy.missions.length > 0 || engine.missions.length > 0;

  // ── List view ──
  return (
    <ErrorBoundary>
      <div className="h-full flex flex-col shrink-0 relative" style={{ width }}>
        <ResizeHandle onMouseDown={onMouseDown} />

        {/* Header */}
        <div className="h-11 flex items-center justify-between px-4 border-b border-border/40 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("missions")}</span>
          <div className="flex items-center gap-1">
            <button onClick={handleNewMission} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title={t("newMission")}>
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
            <button onClick={onToggle} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" title={t("closePanel")}>
              <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
            </div>
          )}

          {!loading && !hasAny && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-xs text-muted-foreground/40">{t("noMissions")}</p>
              <button onClick={handleNewMission} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-foreground text-primary-foreground font-medium">
                {t("createFirst")}
              </button>
            </div>
          )}

          {!loading && hasAny && (
            <div className="p-3 space-y-3">
              {engine.missions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Engine</p>
                  {engine.missions.map(m => (
                    <EngineMissionCard key={m._id} mission={m} onClick={() => handleSelectEngine(m._id)} />
                  ))}
                </div>
              )}
              {legacy.missions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Cron / Flow</p>
                  {legacy.missions.map(m => (
                    <MissionCard key={m.id} mission={m} onClick={() => handleSelectLegacy(m)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sub-Agents */}
          {subAgents.length > 0 && (
            <div className="border-t border-border/30 mt-1">
              <button
                onClick={() => setAgentsCollapsed(!agentsCollapsed)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors"
              >
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("team")}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground/40 tabular-nums">{subAgents.length}</span>
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/40 transition-transform ${agentsCollapsed ? "-rotate-90" : ""}`} />
                </div>
              </button>
              {!agentsCollapsed && (
                <div className="px-2 pb-2 space-y-1">
                  {subAgents.map(sa => (
                    <div key={sa.subAgentId} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border/40">
                      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                        {sa.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{sa.name}</p>
                        {sa.overrides?.model && <p className="text-xs text-muted-foreground/40 truncate">{sa.overrides.model}</p>}
                      </div>
                      {sa.isDefault && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground/50">default</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

// ── Resize handle ───────────────────────────────────────────

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 bottom-0 w-px cursor-col-resize z-10 bg-border/30 hover:bg-foreground/15 hover:w-0.5 active:bg-foreground/20 active:w-0.5 transition-all"
    />
  );
}
