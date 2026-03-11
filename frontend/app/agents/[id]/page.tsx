"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { Navbar } from "@/components/navbar";
import { AgentOverviewHeader } from "@/components/agent-overview-header";
import { ErrorBoundary } from "@/components/error-boundary";
import { apiClient } from "@/lib/api-client";
import { AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { showToast } from "@/components/toast";
import type { ActivityEvent } from "@openclaw-business/shared";

interface ExecApproval {
  requestId: string;
  command: string;
  reason?: string;
  timestamp: string;
  sessionKey?: string;
}

export default function AgentOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [agentId, setAgentId] = useState<string>('');
  const [agent, setAgent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);
  const [liveUsage, setLiveUsage] = useState<{ usage: any; cost: any } | null>(null);
  const [execApprovals, setExecApprovals] = useState<ExecApproval[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<{ totalSessions: number; activeSessions: number; totalMessages: number; messagesByDay: { date: string; count: number }[] } | null>(null);
  const [gatewaySessions, setGatewaySessions] = useState<any[]>([]);
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations('agentDetail');

  useEffect(() => {
    params.then(p => {
      setAgentId(p.id);
    });
  }, [params]);

  const loadData = useCallback(async () => {
    if (!agentId) return;
    try {
      const token = await getToken();
      if (!token) { router.push('/sign-in'); return; }

      const results = await Promise.allSettled([
        apiClient.getAgent(token, agentId),
        apiClient.getActivity(token, { agentId, limit: 5 }),
        apiClient.getAgentUsage(token, agentId),
        apiClient.listExecApprovals(token, agentId),
        apiClient.getAgentAnalytics(token, agentId),
        apiClient.getGatewaySessions(token, agentId),
      ]);
      
      const data = results[0].status === 'fulfilled' ? results[0].value : null;
      const activityData = results[1].status === 'fulfilled' ? results[1].value : { events: [] };
      const usageData = results[2].status === 'fulfilled' ? results[2].value : null;
      const approvalsData = results[3].status === 'fulfilled' ? results[3].value : { approvals: [] };
      const analyticsData = results[4].status === 'fulfilled' ? results[4].value : null;
      const sessionsData = results[5].status === 'fulfilled' ? results[5].value : { sessions: [] };
      
      if (!data) throw new Error('Failed to load agent');
      setAgent(data.agent);
      setRecentActivity(activityData.events || []);
      if (usageData) setLiveUsage(usageData);
      setExecApprovals(approvalsData.approvals || []);
      if (analyticsData?.analytics) setAnalytics(analyticsData.analytics);
      setGatewaySessions(sessionsData.sessions || []);
    } catch (err) {
      if ((err as any)?.status === 404) { setError(t('notFoundDesc')); return; }
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, getToken, router, t]);

  useEffect(() => {
    if (!agentId) return;
    loadData();
    const interval = setInterval(() => { void loadData(); }, 15_000);
    return () => clearInterval(interval);
  }, [agentId, loadData]);

  const handleResolveApproval = async (requestId: string, approved: boolean) => {
    setResolvingId(requestId);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.resolveExecApproval(token, agentId, requestId, approved);
      setExecApprovals(prev => prev.filter(a => a.requestId !== requestId));
      showToast(approved ? t('approvalApproved') : t('approvalRejected'), "success");
    } catch {
      showToast(t('approvalResolveFailed'), "error");
    } finally {
      setResolvingId(null);
    }
  };

  const embeddedWrapper = (content: React.ReactNode) => (
    <div className="min-h-screen flex flex-col bg-background p-1 md:p-2">
      <div className="flex-1 flex flex-col min-h-0 rounded-xl shadow-[0_2px_12px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.25)] border border-gray-200/30 dark:border-border/30 overflow-hidden bg-card">
        <Navbar embedded />
        <main className="flex-1 overflow-auto w-full px-4 sm:px-5 py-4 sm:py-5">
          {content}
        </main>
      </div>
    </div>
  );

  if (isLoading) {
    return embeddedWrapper(<div className="text-center text-muted-foreground">{t('loading')}</div>);
  }

  if (error || !agent) {
    return embeddedWrapper(<div className="text-center text-red-500">{error || t('notFound')}</div>);
  }

  const totalMessages = agent.metrics?.gatewayMessages || analytics?.totalMessages || agent.metrics?.totalMessages || 0;
  const totalCost = agent.metrics?.totalCost || 0;
  const liveCost = liveUsage?.cost?.totalCost;
  const channelCount = agent.channels?.filter((c: any) => c.status === 'connected' || c.status === 'running').length || 0;

  const totalTokens = (agent.metrics?.totalTokens ?? 0);
  const totalSessions = gatewaySessions.length || analytics?.totalSessions || 0;
  const messagesByDay = analytics?.messagesByDay || [];

  const createdDaysAgo = Math.max(1, Math.floor((Date.now() - new Date(agent.createdAt).getTime()) / 86400000));
  const dailyAvgMessages = Math.round(totalMessages / createdDaysAgo);
  const avgTokensPerMsg = totalMessages > 0 ? Math.round(totalTokens / totalMessages) : 0;
  const avgCostPerSession = totalSessions > 0 ? (liveCost ?? totalCost) / totalSessions : 0;

  return embeddedWrapper(
    <ErrorBoundary>
      <AgentOverviewHeader agentId={agentId} />

        <div className="space-y-5">
          {/* Exec Approvals Banner */}
          <AnimatePresence>
            {execApprovals.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-xl border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" strokeWidth={2} />
                  <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t('approvalBanner', { count: execApprovals.length })}
                  </h3>
                </div>
                <div className="space-y-2">
                  {execApprovals.map((approval) => (
                    <div key={approval.requestId} className="flex items-start justify-between gap-4 rounded-lg bg-card/40 p-3 border border-amber-200 dark:border-amber-800/50">
                      <div className="flex-1 min-w-0">
                        <code className="text-xs font-mono text-gray-900 dark:text-foreground block truncate">
                          {approval.command}
                        </code>
                        {approval.reason && (
                          <p className="text-xs text-muted-foreground mt-1">{approval.reason}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(approval.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleResolveApproval(approval.requestId, true)}
                          disabled={resolvingId === approval.requestId}
                          className="px-3 py-1.5 rounded-lg text-xs bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                        >
                          {t('approve')}
                        </button>
                        <button
                          onClick={() => handleResolveApproval(approval.requestId, false)}
                          disabled={resolvingId === approval.requestId}
                          className="px-3 py-1.5 rounded-lg text-xs border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        >
                          {t('reject')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Business Performance Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('statusLabel')}</div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${agent.status === 'running' ? 'bg-green-500 animate-pulse' : agent.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                <span className="text-lg font-medium capitalize">{agent.status === 'running' ? t('statusActive') : agent.status}</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {channelCount > 0
                  ? t('connectedChannels', { count: channelCount })
                  : t('pendingChannels', { count: agent.channels?.length || 0 })}
              </div>
            </div>

            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('messagesLabel')}</div>
              <div className="text-2xl font-mono font-medium">{totalMessages.toLocaleString()}</div>
              <div className="text-xs text-gray-400 mt-1">
                {t('sessionsPerDay', { sessions: totalSessions, perDay: dailyAvgMessages })}
              </div>
            </div>

            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('tokensUsedLabel')}</div>
              <div className="text-2xl font-mono font-medium">
                {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(totalTokens > 100000 ? 0 : 1)}k` : totalTokens.toLocaleString()}
              </div>
              <div className="text-xs text-gray-400 mt-1">{t('tokensPerMessage', { count: avgTokensPerMsg.toLocaleString() })}</div>
            </div>

            <div className="card">
              <div className="text-xs text-muted-foreground mb-1">{t('aiCostLabel')}</div>
              <div className="text-2xl font-mono font-medium">{'\u20AC'}{(liveCost ?? totalCost).toFixed(2)}</div>
              <div className="text-xs text-gray-400 mt-1">
                {totalSessions > 0 ? `${'\u20AC'}${avgCostPerSession.toFixed(3)}/session` : t('noSessionsYet')}
              </div>
            </div>
          </div>

          {/* Agent Info */}
          <div className="card space-y-4">
            <h2 className="section-header">
              {t('configuration')}
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('nameLabel')}</span>
                <span className="font-medium">{agent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('useCaseLabel')}</span>
                <span className="font-medium capitalize">{agent.useCase}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('modelLabel')}</span>
                <span className="font-mono text-xs">{agent.config?.model}</span>
              </div>
              {agent.description && (
                <div className="pt-3 border-t border-border">
                  <span className="text-muted-foreground block mb-2">{t('descriptionLabel')}</span>
                  <p className="text-gray-900 dark:text-foreground">{agent.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Activity Chart + Recent Events */}
          <div className="card space-y-6">
            <h2 className="section-header">
              {t('recentActivity')}
            </h2>
            {messagesByDay.length > 0 ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={messagesByDay.map(d => ({ date: d.date.slice(5), messages: d.count }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="currentColor" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} />
                    <Area type="monotone" dataKey="messages" stroke="currentColor" strokeWidth={1.5} fill="url(#msgGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">{t('noActivity')}</div>
                </div>
              </div>
            )}
            {recentActivity.length > 0 && (
              <div className="space-y-2 border-t border-border pt-4">
                {recentActivity.map((event, i) => (
                  <div key={event._id?.toString() || i} className="flex items-center justify-between py-3 border-b border-border/60 last:border-0">
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
            )}
          </div>
        </div>
    </ErrorBoundary>
  );
}
