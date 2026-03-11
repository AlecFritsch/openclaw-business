'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { apiClient } from '@/lib/api-client';
import { AgentCreationChoice } from '@/components/agent-creation-choice';
import { SkeletonCard } from '@/components/skeleton-loader';
import { Plus } from 'lucide-react';
import type { OperationsOverview, ActivityEvent, Agent } from '@openclaw-business/shared';

const CACHE_KEY = 'havoc:dashboard';
function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeCache(data: any) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

export default function DashboardPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');

  const cached = typeof window !== 'undefined' ? readCache() : null;
  const [overview, setOverview] = useState<OperationsOverview | null>(cached?.overview ?? null);
  const [agents, setAgents] = useState<Agent[]>(cached?.agents ?? []);
  const [activity, setActivity] = useState<ActivityEvent[]>(cached?.activity ?? []);
  const [isLoading, setIsLoading] = useState(!cached);
  const [showChoice, setShowChoice] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        const token = await getToken();
        if (!token) return;
        const [opsData, agentsData, activityData] = await Promise.all([
          apiClient.getOperationsOverview(token).catch(() => null),
          apiClient.getAgents(token).catch(() => ({ agents: [] })),
          apiClient.getActivity(token, { limit: 5 }).catch(() => ({ events: [] })),
        ]);
        if (opsData) setOverview(opsData);
        setAgents(agentsData.agents || []);
        setActivity(activityData.events || []);
        writeCache({ overview: opsData, agents: agentsData.agents, activity: activityData.events });
      } catch {}
      finally { setIsLoading(false); }
    })();
  }, [user, getToken]);

  const runningCount = useMemo(() => agents.filter(a => a.status === 'running').length, [agents]);
  const totalMessages = useMemo(
    () => (overview as any)?.messages?.total ?? agents.reduce((s, a) => s + (a.metrics?.totalMessages || 0), 0),
    [overview, agents]
  );
  const totalCost = useMemo(
    () => (overview as any)?.cost?.total ?? agents.reduce((s, a) => s + (a.metrics?.totalCost || 0), 0),
    [overview, agents]
  );

  const statusColor = useCallback((status: string) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'deploying': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-400 dark:bg-muted';
    }
  }, []);

  const onCloseChoice = useCallback(() => setShowChoice(false), []);

  return (
    <AppShell embedded>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium">
            {user?.firstName ? `Welcome back, ${user.firstName}` : t('title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headerSubtitle', { count: agents.length, running: runningCount })}
          </p>
        </div>
        <button
          onClick={() => setShowChoice(true)}
          className="btn-primary-sm"
          aria-label={t('newAgent')}
        >
          <Plus className="w-3.5 h-3.5" />
          {t('newAgent')}
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="space-y-5">
          {/* KPI Cards */}
          <div id="tour-kpis" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('kpiActiveAgents')}</div>
              <div className="text-2xl font-mono font-medium">{runningCount}</div>
              <div className="text-xs text-gray-400 mt-1">{agents.length} {t('kpiActiveAgentsSuffix')}</div>
            </div>
            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('kpiMessages')}</div>
              <div className="text-2xl font-mono font-medium">{totalMessages.toLocaleString()}</div>
              <div className="text-xs text-gray-400 mt-1">{t('kpiMessagesSuffix')}</div>
            </div>
            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('kpiAiCost')}</div>
              <div className="text-2xl font-mono font-medium">{'\u20AC'}{totalCost.toFixed(2)}</div>
              <div className="text-xs text-gray-400 mt-1">{t('kpiAiCostSuffix')}</div>
            </div>
            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('kpiChannels')}</div>
              <div className="text-2xl font-mono font-medium">
                {agents.reduce((s, a) => s + (a.channels?.length || 0), 0)}
              </div>
              <div className="text-xs text-gray-400 mt-1">{t('kpiChannelsSuffix')}</div>
            </div>
          </div>

          {/* Agents Grid */}
          <div>
            <h2 className="section-header mb-3">{t('agentsSection')}</h2>
            {agents.length === 0 ? (
              <div className="box-empty border-gray-300 dark:border-border p-12 text-center space-y-3">
                <div className="text-2xl font-light text-gray-300 dark:text-muted-foreground">+</div>
                <h3 className="text-base font-medium">{t('buildFirstAgent')}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {t('buildFirstAgentDesc')}
                </p>
                <button
                  onClick={() => router.push("/agents/builder")}
                  className="btn-primary-sm mt-2"
                >
                  {t('buildWithAi')}
                </button>
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {agents.map((agent) => (
                  <button
                    key={String(agent._id)}
                    onClick={() => router.push(`/agents/${agent._id}/workspace`)}
                    className="card text-left group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-sm group-hover:text-black dark:group-hover:text-foreground transition-colors line-clamp-1">
                        {agent.name}
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className={`w-2 h-2 rounded-full ${statusColor(agent.status)} ${agent.status === "running" ? "animate-pulse" : ""}`} />
                        <span className="section-header">
                          {agent.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {agent.description || tc('noDescription')}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground uppercase tracking-wider">
                      <span>{t('agentChannels', { count: agent.channels?.length || 0 })}</span>
                      <span>{agent.metrics?.totalMessages || 0} msgs</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          {activity.length > 0 && (
            <div className="card space-y-3">
              <h2 className="section-header">{t('recentActivity')}</h2>
              <div className="space-y-0">
                {activity.map((event, i) => (
                  <div key={event._id?.toString() || i} className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-0">
                    <div>
                      <div className="text-sm">{event.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{event.description}</div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono whitespace-nowrap ml-4">
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AgentCreationChoice open={showChoice} onClose={onCloseChoice} />
    </AppShell>
  );
}
