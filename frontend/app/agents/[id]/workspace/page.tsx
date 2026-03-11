"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Navbar } from "@/components/navbar";
import { apiClient } from "@/lib/api-client";
import { HavocChatRuntime } from "@/lib/havoc-chat-runtime";
import { HavocChatView } from "@/components/workspace/havoc-chat-view";
import { MissionsPanel } from "@/components/workspace/missions-panel";
import { SessionSidebar } from "@/components/workspace/session-sidebar";
import { useEventStream } from "@/lib/use-event-stream";
import { useHavocChat } from "@/hooks/use-havoc-chat";

export default function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const [agentId, setAgentId] = useState("");
  const toast = useTranslations('toasts');
  const tWorkspace = useTranslations('workspace');
  const tChat = useTranslations('workspace.chatPanel');
  const { getToken } = useAuth();

  // ── Knowledge State ──
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(true);
  const [enabledSources, setEnabledSources] = useState<Set<string>>(() => new Set(["platform", "google_drive", "notion"]));

  // ── Agent + Health State ──
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null); // null = loading

  // ── Workbench Data ──
  const [memoryFiles, setMemoryFiles] = useState<string[]>([]);
  const [subAgents, setSubAgents] = useState<any[]>([]);
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState("");

  // ── Panel State ──
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(!e.matches);
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => { params.then((p) => setAgentId(p.id)); }, [params]);

  // ── Reload helpers ──
  const reloadMemory = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.listMemoryFiles(token, agentId);
      setMemoryFiles(data.files || []);
    } catch {}
  }, [agentId, getToken]);

  const reloadSubAgents = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getSubAgents(token, agentId);
      setSubAgents(data.subAgents || []);
    } catch {}
  }, [agentId, getToken]);

  const reloadCron = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getGatewayCronJobs(token, agentId);
      setCronJobs(data.jobs || []);
    } catch {}
  }, [agentId, getToken]);

  const syncWorkflows = useCallback(async () => {
    try {
      const token = await getToken();
      if (token) apiClient.syncWorkflows(token, agentId).catch(() => {});
    } catch {}
  }, [agentId, getToken]);

  // ── Chat Hook ──
  const chat = useHavocChat({
    agentId,
    knowledgeEnabled,
    enabledSources,
    onMemoryReload: reloadMemory,
    onWorkflowSync: syncWorkflows,
  });

  // ── Load agent + workbench data ──
  const loadAllData = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token || !agentId) return;
      const [agentData, healthData, statsData, cronData, memData, saData, logsData] =
        await Promise.allSettled([
          apiClient.getAgent(token, agentId),
          apiClient.getGatewayHealth(token, agentId),
          apiClient.getGatewayStats(token, agentId),
          apiClient.getGatewayCronJobs(token, agentId),
          apiClient.listMemoryFiles(token, agentId),
          apiClient.getSubAgents(token, agentId),
          apiClient.getGatewayLogs(token, agentId, 100),
        ]);
      if (agentData.status === "fulfilled") {
        setAgentStatus(agentData.value?.agent?.status ?? null);
        setPausedReason((agentData.value?.agent as any)?.pausedReason ?? null);
      }
      if (healthData.status === "fulfilled") setHealth(healthData.value.health);
      if (statsData.status === "fulfilled") setStats(statsData.value);
      if (cronData.status === "fulfilled") setCronJobs(cronData.value.jobs || []);
      if (memData.status === "fulfilled") setMemoryFiles(memData.value.files || []);
      if (saData.status === "fulfilled") setSubAgents(saData.value.subAgents || []);
      if (logsData.status === "fulfilled") setLogs(logsData.value.logs || "");
      // Check if org has any AI providers configured
      try {
        const modelsData = await apiClient.getAvailableModels(token);
        setHasProvider((modelsData.models?.length ?? 0) > 0);
      } catch { setHasProvider(false); }
    } catch {}
  }, [agentId, getToken]);

  useEffect(() => { if (agentId) loadAllData(); }, [agentId, loadAllData]);

  // ── Polling (agent status, health, stats, cron) ──
  useEffect(() => {
    if (!agentId) return;
    const interval = setInterval(async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const [agentData, healthData, statsData, cronData] = await Promise.allSettled([
          apiClient.getAgent(token, agentId),
          apiClient.getGatewayHealth(token, agentId),
          apiClient.getGatewayStats(token, agentId),
          apiClient.getGatewayCronJobs(token, agentId),
        ]);
        if (agentData.status === "fulfilled") {
          setAgentStatus(agentData.value?.agent?.status ?? null);
          setPausedReason((agentData.value?.agent as any)?.pausedReason ?? null);
        }
        if (healthData.status === "fulfilled") setHealth(healthData.value.health);
        if (statsData.status === "fulfilled") setStats(statsData.value);
        if (cronData.status === "fulfilled") setCronJobs(cronData.value.jobs || []);
      } catch {}
    }, 12000);
    return () => clearInterval(interval);
  }, [agentId, getToken]);

  // ── Auto-open Missions panel on workflow/cron events ──
  useEventStream({
    filter: (e) => e.agentId === agentId && (
      e.event === 'workflow:update' || e.event === 'lobster:started' ||
      e.event === 'lobster:complete' || e.event === 'cron'
    ),
    onEvent: () => {
      setRightPanelOpen(true);
    },
    enabled: !!agentId,
  });

  // ── Panel toggles ──
  const toggleLeftPanel = () => setLeftPanelOpen((v) => !v);
  const toggleRightPanel = () => setRightPanelOpen((v) => !v);

  // ── Slash command: /new — clear messages to start fresh session ──
  useEffect(() => {
    const handler = () => { chat.setMessages([]); };
    window.addEventListener("slash-new-session", handler);
    return () => window.removeEventListener("slash-new-session", handler);
  }, [chat.setMessages]);

  const handleMobileSelectSession = (key: string) => {
    chat.selectSession(key);
    if (isMobile) setLeftPanelOpen(false);
  };

  const handleAbort = async () => {
    await chat.abort();
    // showToast(toast("agentStopped"), "success");
  };

  return (
    <div className="h-screen flex flex-col bg-background p-1 md:p-2">
      <div className="flex-1 flex flex-col min-h-0 box-modal overflow-hidden">
        <Navbar embedded />

        {/* Mobile toolbar */}
        <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border/40 shrink-0">
          <button
            onClick={toggleLeftPanel}
            className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium ${leftPanelOpen ? 'bg-foreground text-primary-foreground shadow-sm' : 'bg-gray-200/80 dark:bg-secondary/80 text-muted-foreground'}`}
          >
            {tWorkspace('sessionSidebar.chats')}
          </button>
          <div className="flex items-center gap-2">
            {(health?.status === "ok" || health?.status === "running") && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Live</span>
              </div>
            )}
          </div>
          <button
            onClick={toggleRightPanel}
            className={`text-xs px-3 py-1.5 rounded-full transition-all font-medium ${rightPanelOpen ? 'bg-foreground text-primary-foreground shadow-sm' : 'bg-gray-200/80 dark:bg-secondary/80 text-muted-foreground'}`}
          >
            {tWorkspace('missionsPanel.missions')}
          </button>
        </div>

        {/* Chat + Workbench layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden relative">

        {/* Left: Sessions */}
        <div className={`${isMobile ? 'absolute inset-y-0 left-0 z-30 w-64 rounded-r-xl shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden bg-card' : 'flex flex-col h-full shrink-0 border-r border-border/30'} ${isMobile && !leftPanelOpen ? 'hidden' : ''}`}>
          <SessionSidebar
            sessions={chat.sessions}
            selectedSession={chat.selectedSession}
            onSelectSession={isMobile ? handleMobileSelectSession : chat.selectSession}
            health={health}
            stats={stats}
            isOpen={isMobile ? true : leftPanelOpen}
            onToggle={toggleLeftPanel}
          />
        </div>

        {/* Center: Chat */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
        {agentStatus === "deploying" && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-card/95 backdrop-blur-sm">
            <div className="box flex flex-col items-center gap-4 px-6 py-8 bg-background/95">
              <div className="w-8 h-8 border-2 border-gray-300 dark:border-border border-t-black dark:border-t-white rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground text-center max-w-xs">{tWorkspace("startingOverlay")}</p>
            </div>
          </div>
        )}
        {agentStatus === "stopped" && (
          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b bg-amber-50 dark:bg-amber-950/40 border-amber-200/60 dark:border-amber-800/40">
            <span className="text-sm text-amber-800 dark:text-amber-200">{tWorkspace("pausedBanner")}</span>
            <Link
              href={`/agents/${agentId}`}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-amber-200/60 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800"
            >
              {tWorkspace("pausedBannerResume")}
            </Link>
          </div>
        )}
        {hasProvider === false && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-card/95 backdrop-blur-sm">
            <div className="box flex flex-col items-center gap-3 px-8 py-8 bg-background/95 max-w-sm text-center">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              </div>
              <p className="text-sm font-medium text-foreground">{tChat("noProviderTitle")}</p>
              <p className="text-xs text-muted-foreground">{tChat("noProviderDescription")}</p>
              <Link
                href="/settings"
                className="mt-1 text-xs font-medium px-4 py-2 rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors"
              >
                {tChat("noProviderLink")}
              </Link>
            </div>
          </div>
        )}
        <HavocChatRuntime
          messages={chat.messages}
          setMessages={chat.setMessages}
          isRunning={chat.isSending}
          streamingContent={chat.streamingText}
          onSend={chat.send}
          onAbort={handleAbort}
        >
          <HavocChatView
            agentId={agentId}
            sessionKey={chat.selectedSession}
            messages={chat.messages}
            isConnecting={chat.isConnecting}
            knowledgeEnabled={knowledgeEnabled}
            setKnowledgeEnabled={setKnowledgeEnabled}
            enabledSources={enabledSources}
            toggleSource={(source: string) => {
              setEnabledSources(prev => {
                const next = new Set(prev);
                if (next.has(source)) next.delete(source);
                else next.add(source);
                return next;
              });
            }}
          />
        </HavocChatRuntime>
        </div>

        {/* Right: Workbench */}
        <div className={`${isMobile ? 'absolute inset-y-0 right-0 z-30 w-80 rounded-l-xl shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden bg-card' : 'flex flex-col h-full shrink-0'} ${isMobile && !rightPanelOpen ? 'hidden' : ''}`}>
          <MissionsPanel
            agentId={agentId}
            isOpen={isMobile ? true : rightPanelOpen}
            onToggle={toggleRightPanel}
            cronJobs={cronJobs}
            onCronReload={reloadCron}
            subAgents={subAgents}
            onSubAgentsReload={reloadSubAgents}
          />
        </div>

        {/* Mobile backdrop */}
        {isMobile && (leftPanelOpen || rightPanelOpen) && (
          <div className="absolute inset-0 z-20 bg-black/30 dark:bg-background/50 backdrop-blur-[2px]" onClick={() => { setLeftPanelOpen(false); setRightPanelOpen(false); }} />
        )}
        </div>
      </div>
    </div>
  );
}
