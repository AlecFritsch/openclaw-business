"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { motion } from "motion/react";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { Database, Search, BarChart3 } from "lucide-react";
import { SectionLabel } from "@/components/knowledge/knowledge-ui";
import { AddSourcePanel } from "@/components/knowledge/add-source-panel";
import { SourceList } from "@/components/knowledge/source-list";
import { SearchPanel } from "@/components/knowledge/search-analytics";
import { AnalyticsPanel } from "@/components/knowledge/search-analytics";
import { IntegrationPicker } from "@/components/knowledge/integration-picker";
import type { KnowledgeSource, SearchResult } from "@/components/knowledge/knowledge-ui";

// ── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'sources' | 'search' | 'analytics';

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'sources', label: 'Sources', icon: <Database className="w-4 h-4" strokeWidth={1.5} /> },
  { key: 'search', label: 'Search', icon: <Search className="w-4 h-4" strokeWidth={1.5} /> },
  { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" strokeWidth={1.5} /> },
];

// ── Integration types ────────────────────────────────────────────────────────

interface Integration {
  _id: string;
  type: 'google_drive' | 'notion';
  label: string;
  lastSyncAt: string | null;
  syncStatus?: 'syncing' | 'error' | 'idle' | null;
  syncProgress?: { total: number; completed: number; failed: number; currentItem: string } | null;
  createdAt: string;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>('sources');
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [pickerIntegration, setPickerIntegration] = useState<Integration | null>(null);
  const { getToken } = useAuth();
  const confirm = useConfirm();
  
  // Refs to track intervals and prevent stacking
  const sourcesIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const integrationsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Handle OAuth callback fallback (redirect with code in URL) ───────────

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthError = url.searchParams.get('oauth_error');
    if (oauthError === 'invalid_state') {
      url.searchParams.delete('oauth_error');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
      showToast('OAuth abgelaufen oder ungültig. Bitte erneut verbinden.', 'error');
      return;
    }
    const notionCode = url.searchParams.get('notion_code');
    const googleCode = url.searchParams.get('google_code');
    if (!notionCode && !googleCode) return;
    // Clean URL
    url.searchParams.delete('notion_code');
    url.searchParams.delete('google_code');
    window.history.replaceState({}, '', url.pathname);

    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        if (notionCode) {
          const res = await apiClient.exchangeNotionCode(token, notionCode);
          showToast('Notion connected', 'success');
          await loadIntegrations();
          if (res.integration) setPickerIntegration({ ...res.integration, type: 'notion' });
        } else if (googleCode) {
          const res = await apiClient.exchangeGoogleCode(token, googleCode);
          showToast('Google Drive connected', 'success');
          await loadIntegrations();
          if (res.integration) setPickerIntegration({ ...res.integration, type: 'google_drive' });
        }
      } catch (e: any) { showToast(e.message || 'Connection failed', 'error'); }
    })();
  }, [getToken]);

  // ── Load sources ─────────────────────────────────────────────────────────

  const loadSources = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getKnowledgeSources(token);
      setSources(data.sources || []);
    } catch { /* silent */ } finally { setIsLoading(false); }
  }, [getToken]);

  useEffect(() => {
    loadSources();
    if (sourcesIntervalRef.current) {
      clearInterval(sourcesIntervalRef.current);
    }
    sourcesIntervalRef.current = setInterval(loadSources, 15000);
    return () => {
      if (sourcesIntervalRef.current) {
        clearInterval(sourcesIntervalRef.current);
      }
    };
  }, [loadSources]);

  // ── Load integrations ────────────────────────────────────────────────────

  const loadIntegrations = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getKnowledgeIntegrations(token);
      setIntegrations(data.integrations || []);
    } catch { /* silent */ }
  }, [getToken]);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  // Poll integrations faster while any sync is active
  useEffect(() => {
    const isSyncing = integrations.some(i => i.syncStatus === 'syncing');
    if (!isSyncing) return;
    
    if (integrationsIntervalRef.current) {
      clearInterval(integrationsIntervalRef.current);
    }
    integrationsIntervalRef.current = setInterval(loadIntegrations, 1500);
    
    return () => {
      if (integrationsIntervalRef.current) {
        clearInterval(integrationsIntervalRef.current);
      }
    };
  }, [integrations, loadIntegrations]);

  // ── Load analytics ───────────────────────────────────────────────────────

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getKnowledgeAnalytics(token);
      const raw: any[] = data.stats || [];
      const totalSources = raw.length;
      const totalChunks = raw.reduce((s: number, r: any) => s + (r.chunkCount || 0), 0);
      const totalHits = raw.reduce((s: number, r: any) => s + (r.hitCount || 0), 0);
      const topSources = raw.filter((r: any) => (r.hitCount || 0) > 0).slice(0, 10).map((r: any) => ({ name: r.name, hitCount: r.hitCount || 0, type: r.type }));
      setAnalyticsData({ totalSources, totalChunks, totalHits, topSources });
    } catch { /* silent */ } finally { setAnalyticsLoading(false); }
  }, [getToken]);

  useEffect(() => { if (tab === 'analytics') loadAnalytics(); }, [tab, loadAnalytics]);

  // Cleanup all intervals on unmount
  useEffect(() => {
    return () => {
      if (sourcesIntervalRef.current) {
        clearInterval(sourcesIntervalRef.current);
      }
      if (integrationsIntervalRef.current) {
        clearInterval(integrationsIntervalRef.current);
      }
    };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleUpload = async (files: FileList) => {
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) return;
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        await apiClient.uploadKnowledgeFile(token, formData);
      }
      showToast(`${files.length} file(s) uploaded`, 'success');
      loadSources();
    } catch (e: any) { showToast(e.message || 'Upload failed', 'error'); } finally { setUploading(false); }
  };

  const handleAddText = async (name: string, content: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.addKnowledgeText(token, { name, content });
      showToast('Text added', 'success');
      loadSources();
    } catch (e: any) { showToast(e.message || 'Failed', 'error'); }
  };

  const handleCrawl = async (url: string, maxPages: number, maxDepth: number, schedule: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.crawlWebsite(token, { url, maxPages, maxDepth, schedule: schedule === 'none' ? undefined : schedule });
      showToast('Crawl started', 'success');
      loadSources();
    } catch (e: any) { showToast(e.message || 'Crawl failed', 'error'); }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Delete source', description: 'This will permanently delete this source and all its chunks.', confirmLabel: 'Delete', variant: 'destructive' });
    if (!ok) return;
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.deleteKnowledgeSource(token, id);
      setSources(prev => prev.filter(s => s._id !== id && s.crawlJobId !== id));
      showToast('Source deleted', 'success');
    } catch (e: any) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const handleLoadChunks = async (sourceId: string): Promise<any[]> => {
    try {
      const token = await getToken();
      if (!token) return [];
      const data = await apiClient.getKnowledgeChunks(token, sourceId);
      return data.chunks || [];
    } catch { return []; }
  };

  const handleSearch = async (query: string): Promise<SearchResult[]> => {
    try {
      const token = await getToken();
      if (!token) return [];
      const data = await apiClient.searchKnowledge(token, { query });
      return data.results || [];
    } catch { return []; }
  };

  // ── Integration actions ──────────────────────────────────────────────────

  const connectGoogle = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.getGoogleAuthUrl(token);
      window.location.href = url;
    } catch (e: any) { showToast(e.message || 'Failed', 'error'); }
  };

  const connectNotion = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.getNotionAuthUrl(token);
      window.location.href = url;
    } catch (e: any) { showToast(e.message || 'Failed', 'error'); }
  };
  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.syncIntegration(token, id);
      showToast('Sync started — sources will appear shortly', 'success');
      loadSources();
      loadIntegrations();
    } catch (e: any) { showToast(e.message || 'Sync failed', 'error'); } finally { setSyncingId(null); }
  };

  const handleDisconnect = async (id: string) => {
    const ok = await confirm({ title: 'Disconnect integration', description: 'This will remove the connection. Existing imported sources will remain.', confirmLabel: 'Disconnect', variant: 'destructive' });
    if (!ok) return;
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.deleteIntegration(token, id);
      setIntegrations(prev => prev.filter(i => i._id !== id));
      showToast('Disconnected', 'success');
    } catch (e: any) { showToast(e.message || 'Failed', 'error'); }
  };

  // ── Counts ───────────────────────────────────────────────────────────────

  const readyCount = sources.filter(s => s.status === 'ready').length;
  const processingCount = sources.filter(s => s.status === 'processing').length;
  const totalChunks = sources.reduce((sum, s) => sum + (s.chunkCount || 0), 0);

  const googleIntegration = integrations.find(i => i.type === 'google_drive');
  const notionIntegration = integrations.find(i => i.type === 'notion');

  const SyncStatus = ({ integration: ig }: { integration: Integration }) => {
    if (ig.syncStatus !== 'syncing' || !ig.syncProgress) return null;
    const { total, completed, failed, currentItem } = ig.syncProgress;
    const pct = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{completed + failed}/{total}</span>
        </div>
        {currentItem && (
          <p className="text-xs text-muted-foreground truncate">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1 align-middle" />
            {currentItem}
          </p>
        )}
        {failed > 0 && <p className="text-xs text-red-500">{failed} failed</p>}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <AppShell embedded>
      <div className="mb-6">
        <h1 className="text-xl font-medium">Knowledge</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isLoading ? 'Loading…' : (
            sources.length === 0 ? 'Add documents, text, or crawl websites to build your agent\'s knowledge base.' :
            `${readyCount} source${readyCount !== 1 ? 's' : ''} ready · ${totalChunks.toLocaleString()} chunks${processingCount > 0 ? ` · ${processingCount} processing` : ''}`
          )}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-4 sm:gap-6 border-b border-border mb-6 overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`pb-3 text-sm transition-colors relative flex items-center gap-2 whitespace-nowrap ${tab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70'}`}>
            {t.icon}{t.label}
            {tab === t.key && <motion.div layoutId="knowledge-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'sources' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
          <SectionLabel label="Add Sources" />
          <div id="tour-knowledge-sources">
            <AddSourcePanel onUploadFiles={handleUpload} onAddText={handleAddText} onCrawl={handleCrawl} uploading={uploading} />
          </div>

          {/* Integrations */}
          <SectionLabel label="Integrations" />
          <div id="tour-knowledge-integrations" className="flex flex-col sm:flex-row gap-3">
            {/* Google Drive */}
            <div className="box p-4 sm:flex-1 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-border/80 flex items-center justify-center shrink-0 bg-muted/30">
                  <img src="/logos/google-drive.svg" alt="Google Drive" className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm">Google Drive</h3>
                  {googleIntegration ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Connected{googleIntegration.lastSyncAt ? ` · Last sync ${new Date(googleIntegration.lastSyncAt).toLocaleDateString()}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Import docs, sheets & slides</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {googleIntegration ? (
                  <>
                    <button onClick={() => setPickerIntegration(googleIntegration)} disabled={googleIntegration.syncStatus === 'syncing'}
                      className="text-xs px-3 py-1.5 rounded-xl bg-foreground text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity">
                      {googleIntegration.syncStatus === 'syncing' ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <button onClick={() => handleDisconnect(googleIntegration._id)}
                      className="text-xs px-3 py-1.5 rounded-xl border border-border text-red-600 dark:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors">
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button onClick={connectGoogle}
                    className="text-xs px-3 py-1.5 rounded-xl bg-foreground text-primary-foreground hover:opacity-90 transition-opacity">
                    Connect
                  </button>
                )}
              </div>
              {googleIntegration && <SyncStatus integration={googleIntegration} />}
            </div>

            {/* Notion */}
            <div className="box p-4 sm:flex-1 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-border/80 flex items-center justify-center shrink-0 bg-muted/30">
                  <img src="/logos/notion.svg" alt="Notion" className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm">Notion</h3>
                  {notionIntegration ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {notionIntegration.label || 'Connected'}{notionIntegration.lastSyncAt ? ` · Last sync ${new Date(notionIntegration.lastSyncAt).toLocaleDateString()}` : ''}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Import pages & databases</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {notionIntegration ? (
                  <>
                    <button onClick={() => setPickerIntegration(notionIntegration)} disabled={notionIntegration.syncStatus === 'syncing'}
                      className="text-xs px-3 py-1.5 rounded-xl bg-foreground text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity">
                      {notionIntegration.syncStatus === 'syncing' ? 'Syncing…' : 'Sync Now'}
                    </button>
                    <button onClick={() => handleDisconnect(notionIntegration._id)}
                      className="text-xs px-3 py-1.5 rounded-xl border border-border text-red-600 dark:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors">
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button onClick={connectNotion}
                    className="text-xs px-3 py-1.5 rounded-xl bg-foreground text-primary-foreground hover:opacity-90 transition-opacity">
                    Connect
                  </button>
                )}
              </div>
              {notionIntegration && <SyncStatus integration={notionIntegration} />}
            </div>
          </div>

          <SectionLabel label={`Sources (${sources.length})`} />
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />)}
            </div>
          ) : (
            <SourceList sources={sources} onDelete={handleDelete} onLoadChunks={handleLoadChunks} />
          )}
        </motion.div>
      )}

      {tab === 'search' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <SearchPanel onSearch={handleSearch} />
        </motion.div>
      )}

      {tab === 'analytics' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <AnalyticsPanel stats={analyticsData} loading={analyticsLoading} />
        </motion.div>
      )}

      {/* Integration Picker Modal */}
      {pickerIntegration && (
        <IntegrationPicker
          integrationId={pickerIntegration._id}
          integrationType={pickerIntegration.type}
          onClose={() => setPickerIntegration(null)}
          onSaved={() => { setPickerIntegration(null); loadSources(); loadIntegrations(); }}
        />
      )}
    </AppShell>
  );
}
