"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { SkeletonCard } from "@/components/skeleton-loader";
import { AgentCreationChoice } from "@/components/agent-creation-choice";
import { Plus, Bot } from "lucide-react";
import type { Agent } from "@openclaw-business/shared";

const AGENTS_CACHE_KEY = 'havoc:agents';

export default function AgentsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const t = useTranslations('agents');
  const tc = useTranslations('common');

  const [showChoice, setShowChoice] = useState(false);

  const cached = typeof window !== 'undefined' ? (() => { try { const r = sessionStorage.getItem(AGENTS_CACHE_KEY); return r ? JSON.parse(r) as Agent[] : null; } catch { return null; } })() : null;
  const [agents, setAgents] = useState<Agent[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.getAgents(token);
        setAgents(data.agents);
        try { sessionStorage.setItem(AGENTS_CACHE_KEY, JSON.stringify(data.agents)); } catch {}
      } catch {}
      finally { setLoading(false); }
    })();
  }, [getToken]);

  const statusColor = useCallback((status: string) => {
    switch (status) {
      case "running": return "bg-green-500";
      case "deploying": return "bg-yellow-500";
      case "error": return "bg-red-500";
      default: return "bg-gray-400 dark:bg-muted";
    }
  }, []);

  const statusLabel = useCallback((status: string) => {
    switch (status) {
      case "running": return t('statusRunning');
      case "deploying": return t('statusDeploying');
      case "stopped": return t('statusStopped');
      case "error": return t('statusError');
      default: return status;
    }
  }, [t]);

  const onCloseChoice = useCallback(() => setShowChoice(false), []);

  return (
    <AppShell embedded>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headerSubtitle', { count: agents.length })}
          </p>
        </div>
        <button
          id="tour-create-agent"
          onClick={() => setShowChoice(true)}
          className="btn-primary-sm"
          aria-label={t('newAgentBtn')}
        >
          <Plus className="w-3.5 h-3.5" />
          {t('newAgentBtn')}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
          <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-sm font-medium mb-1">Erstelle deinen ersten AI Mitarbeiter</h2>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
            Beschreibe was dein Agent tun soll und wir konfigurieren ihn für dich.
          </p>
          <button
            onClick={() => router.push("/agents/builder")}
            className="btn-primary-sm"
          >
            Agent erstellen
          </button>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <button
              key={String(agent._id)}
              onClick={() => router.push(`/agents/${agent._id}/workspace`)}
              className="bg-card border border-border rounded-xl p-4 text-left hover:border-foreground/20 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm group-hover:text-foreground transition-colors line-clamp-1">
                  {agent.name}
                </h3>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className={`w-2 h-2 rounded-full ${statusColor(agent.status)} ${agent.status === "running" ? "animate-pulse" : ""}`} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                {agent.description || tc('noDescription')}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{statusLabel(agent.status)}</span>
                <span>·</span>
                <span>{t('channelsCount', { count: agent.channels?.length || 0 })}</span>
                <span>·</span>
                <span>{t('messagesCount', { count: agent.metrics?.totalMessages || 0 })}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <AgentCreationChoice open={showChoice} onClose={onCloseChoice} />
    </AppShell>
  );
}
