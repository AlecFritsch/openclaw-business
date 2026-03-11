'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import type { ApprovalRequest, ApprovalCounts } from '@openclaw-business/shared';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-gray-100 text-gray-600 dark:bg-secondary dark:text-gray-400',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired: 'bg-gray-100 text-gray-500 dark:bg-secondary dark:text-gray-500',
};

export default function ApprovalsPage() {
  const { getToken } = useAuth();
  const t = useTranslations('approvals');
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [counts, setCounts] = useState<ApprovalCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [rejectNoteId, setRejectNoteId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const fetchApprovals = useCallback(async (signal?: AbortSignal) => {
    try {
      const token = await getToken();
      if (!token) return;
      const params: any = { limit: 100 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const data = await apiClient.listApprovals(token, params);
      if (signal?.aborted) return;
      setApprovals(data.approvals as any);
      setCounts(data.counts);
    } catch {
      // silent
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [getToken, statusFilter]);

  useEffect(() => {
    const ac = new AbortController();
    fetchApprovals(ac.signal);
    return () => ac.abort();
  }, [fetchApprovals]);

  const handleResolve = async (id: string, status: 'approved' | 'rejected', note?: string) => {
    try {
      setResolvingId(id);
      const token = await getToken();
      if (!token) return;
      await apiClient.resolveApproval(token, id, { status, note });
      setRejectNoteId(null);
      setRejectNote('');
      await fetchApprovals();
    } catch {
      // silent
    } finally {
      setResolvingId(null);
    }
  };

  const statusTabs = [
    { key: 'pending', label: t('pending'), count: counts?.pending },
    { key: 'approved', label: t('approved'), count: counts?.approved },
    { key: 'rejected', label: t('rejected'), count: counts?.rejected },
    { key: 'expired', label: t('expired'), count: counts?.expired },
    { key: 'all', label: t('all'), count: counts?.total },
  ];

  const formatDate = (d: string | Date) => {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  /** Time remaining until expiry, or null if expired */
  const getExpiryRemaining = (expiresAt: string | Date | undefined) => {
    if (!expiresAt) return null;
    const exp = new Date(expiresAt);
    const now = new Date();
    const ms = exp.getTime() - now.getTime();
    if (ms <= 0) return { expired: true, label: t('expired') };
    const mins = Math.floor(ms / 60_000);
    const hours = Math.floor(mins / 60);
    if (hours >= 1) return { expired: false, label: t('expiresInHours', { count: hours }), urgent: false };
    if (mins >= 15) return { expired: false, label: t('expiresInMins', { count: mins }), urgent: false };
    return { expired: false, label: t('expiresInMins', { count: mins }), urgent: true };
  };

  return (
    <AppShell embedded>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-medium">{t('title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key); setLoading(true); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                statusFilter === tab.key
                  ? 'bg-foreground text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <p className="text-xs text-gray-400 py-12 text-center">{t('loading')}</p>
        ) : approvals.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyDesc')} />
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <div
                key={approval._id}
                className="border border-border rounded-xl p-4 transition-all hover:border-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{approval.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[approval.priority]}`}>
                        {t(`priority.${approval.priority}` as any)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[approval.status]}`}>
                        {t(approval.status as any)}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {t(`actionType.${approval.actionType}` as any)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{approval.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span>{formatDate(approval.createdAt)}</span>
                      {approval.confidence !== undefined && (
                        <span>{t('confidence')}: {Math.round(approval.confidence * 100)}%</span>
                      )}
                      {approval.expiresAt && approval.status === 'pending' && (() => {
                        const rem = getExpiryRemaining(approval.expiresAt);
                        if (!rem) return <span>{t('expiresAt')}: {formatDate(approval.expiresAt)}</span>;
                        return (
                          <span className={rem.urgent ? 'font-medium text-orange-600 dark:text-orange-400' : rem.expired ? 'font-medium text-red-600 dark:text-red-400' : ''}>
                            {rem.label}
                          </span>
                        );
                      })()}
                      {approval.resolutionNote && (
                        <span className="italic">"{approval.resolutionNote}"</span>
                      )}
                    </div>
                  </div>

                  {/* Actions for pending */}
                  {approval.status === 'pending' && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {rejectNoteId === approval._id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder={t('resolutionPlaceholder')}
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-transparent w-48"
                          />
                          <button
                            onClick={() => handleResolve(approval._id!, 'rejected', rejectNote)}
                            disabled={resolvingId === approval._id}
                            className="text-xs px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {resolvingId === approval._id ? t('rejecting') : t('reject')}
                          </button>
                          <button
                            onClick={() => { setRejectNoteId(null); setRejectNote(''); }}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleResolve(approval._id!, 'approved')}
                            disabled={resolvingId === approval._id}
                            className="text-xs px-3 py-1 rounded-lg bg-foreground text-primary-foreground hover:opacity-80 disabled:opacity-50"
                          >
                            {resolvingId === approval._id ? t('approving') : t('approve')}
                          </button>
                          <button
                            onClick={() => setRejectNoteId(approval._id!)}
                            disabled={resolvingId === approval._id}
                            className="text-xs px-3 py-1 rounded-lg border border-border text-muted-foreground hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400 disabled:opacity-50"
                          >
                            {t('reject')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
