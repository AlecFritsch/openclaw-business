"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { showToast } from "./toast";
import { useConfirm } from "./confirm-dialog";
import { apiClient } from "@/lib/api-client";
import { useTranslations } from 'next-intl';

interface AgentOverviewHeaderProps {
  agentId: string;
}

export function AgentOverviewHeader({ agentId }: AgentOverviewHeaderProps) {
  const t = useTranslations('agentOverviewHeader');
  const [agent, setAgent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { getToken } = useAuth();
  const confirm = useConfirm();

  useEffect(() => {
    const fetchAgent = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.getAgent(token, agentId);
        setAgent(data.agent);
      } catch (error) {
      } finally {
        setIsLoading(false);
      }
    };

    fetchAgent();
  }, [agentId, getToken]);

  const handleTogglePause = async () => {
    if (!agent) return;

    const isRunning = agent.status === 'running';
    if (isRunning && !await confirm({ title: t('pause'), description: t('pauseConfirm'), confirmLabel: t('pause'), variant: 'destructive' })) return;
    
    try {
      const token = await getToken();
      if (!token) return;

      if (isRunning) {
        await apiClient.pauseAgent(token, agentId);
      } else {
        await apiClient.resumeAgent(token, agentId);
      }
      
      setAgent({ ...agent, status: isRunning ? 'stopped' : 'running' });
      showToast(isRunning ? t('agentStopped') : t('agentResumed'), "success");
    } catch (error) {
      showToast(t('failedUpdateStatus'), 'error');
    }
  };

  const handleDelete = async () => {
    if (!agent || !await confirm({ title: t('delete'), description: t('deleteConfirm'), confirmLabel: t('delete'), variant: 'destructive' })) return;
    
    try {
      const token = await getToken();
      if (!token) return;

      await apiClient.deleteAgent(token, agentId);
      showToast(t('agentDeleted'), 'success');
      router.push('/dashboard');
    } catch (error) {
      showToast(t('failedDelete'), 'error');
    }
  };

  if (isLoading || !agent) {
    return (
      <div className="mb-12">
        <div className="text-muted-foreground">{t('loading')}</div>
      </div>
    );
  }

  const getTypeCode = (useCase: string) => {
    switch (useCase) {
      case 'sales': return 'SL';
      case 'support': return 'SP';
      case 'marketing': return 'EM';
      default: return 'AG';
    }
  };

  const getTimeSince = (date: Date | string) => {
    const now = new Date();
    const created = new Date(date);
    const diff = now.getTime() - created.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  };

  return (
    <div className="mb-12">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 border-2 border-gray-300 dark:border-border rounded-xl flex items-center justify-center text-lg font-mono">
            {getTypeCode(agent.useCase)}
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-medium">{agent.name}</h1>
            <div className="flex items-center gap-3 text-sm">
              <span
                className={`status-dot ${
                  agent.status === 'running' 
                    ? 'status-running' 
                    : agent.status === 'stopped'
                    ? 'status-paused'
                    : agent.status === 'deploying'
                    ? 'bg-blue-500'
                    : 'bg-red-500'
                }`}
              />
              <span className="text-muted-foreground capitalize">
                {agent.status === 'stopped' ? t('statusPaused') : agent.status}
              </span>
              {agent.status === 'stopped' && (
                <span className="text-xs text-amber-600 dark:text-amber-500">
                  · {t('statusPausedHint')}
                </span>
              )}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {t('deployed')} {getTimeSince(agent.createdAt)}
              </span>
            </div>
            {agent.description && (
              <p className="text-sm text-muted-foreground max-w-2xl">
                {agent.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(agent.status === 'running' || agent.status === 'stopped') && (
            <button
              onClick={handleTogglePause}
              className="btn-ghost-sm"
            >
              {agent.status === 'stopped' ? t('resume') : t('pause')}
            </button>
          )}
          <button
            onClick={handleDelete}
            className="btn-ghost-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
          >
            {t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
