"use client";

import { AppShell } from "@/components/app-shell";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { ChannelIcon } from "@/components/channel-icon";

/** OpenClaw-native channels (excl. Superchat). */
const OPENCLAW_CHANNELS = [
  { type: 'whatsapp', name: 'WhatsApp', supportsQR: true, needsCredentials: false, category: 'messaging' },
  { type: 'telegram', name: 'Telegram', supportsQR: false, needsCredentials: true, credFields: ['botToken'], category: 'messaging' },
  { type: 'slack', name: 'Slack', supportsQR: false, needsCredentials: true, credFields: ['botToken', 'appToken'], category: 'workspace' },
  { type: 'discord', name: 'Discord', supportsQR: false, needsCredentials: true, credFields: ['botToken'], category: 'workspace' },
  { type: 'msteams', name: 'Microsoft Teams', supportsQR: false, needsCredentials: true, credFields: ['appId', 'appSecret', 'tenantId'], category: 'enterprise' },
  { type: 'googlechat', name: 'Google Chat', supportsQR: false, needsCredentials: true, credFields: ['serviceAccountKey'], category: 'enterprise' },
  { type: 'mattermost', name: 'Mattermost', supportsQR: false, needsCredentials: true, credFields: ['url', 'token'], category: 'enterprise' },
  { type: 'line', name: 'LINE', supportsQR: false, needsCredentials: true, credFields: ['channelAccessToken', 'channelSecret'], category: 'messaging' },
  { type: 'feishu', name: 'Feishu / Lark', supportsQR: false, needsCredentials: true, credFields: ['appId', 'appSecret'], category: 'enterprise' },
];

/** Superchat: single integration for WhatsApp, Instagram, Messenger, Email. */
const SUPERCHAT_CHANNEL = { type: 'superchat', name: 'Superchat', supportsQR: false, needsCredentials: true, credFields: ['apiKey'], category: 'messaging', beta: true };

// Channels that support DM pairing
const PAIRING_CHANNELS = ['whatsapp', 'telegram', 'discord', 'slack', 'signal', 'imessage'];

interface PairingRequest {
  code: string;
  sender?: string;
  channel?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface ChannelStatus {
  _id?: string;
  type: string;
  status: 'connected' | 'disconnected' | 'pending' | 'error';
  dmPolicy?: string;
  allowFrom?: string[];
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
  metrics?: { totalMessages?: number };
  name?: string;
}

const MODAL_OVERLAY = "fixed inset-0 bg-black/40 dark:bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4";

function ModalHeader({ title, subtitle, icon, onClose }: { title: string; subtitle?: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between p-5 border-b border-border/60 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  );
}

function ChannelLogo({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="w-9 h-9 rounded-xl border border-gray-200/80 dark:border-border/60 flex items-center justify-center bg-gray-50/50 dark:bg-card/30 overflow-hidden p-1.5 shrink-0">
      <img src={src} alt={alt} className="w-full h-full object-contain" />
    </div>
  );
}

export default function AgentChannelsPage({ params }: { params: Promise<{ id: string }> }) {
  const [agentId, setAgentId] = useState<string>('');
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [liveChannelStatus, setLiveChannelStatus] = useState<Array<{ type: string; connected?: boolean; status?: string; error?: string }> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [channelModal, setChannelModal] = useState<'superchat' | 'openclaw' | null>(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [addChannelCreds, setAddChannelCreds] = useState<{ type: string; name: string; credFields?: string[] } | null>(null);
  const [credForm, setCredForm] = useState<Record<string, string>>({});
  const [addChannelDmPolicy, setAddChannelDmPolicy] = useState<string>('pairing');
  const [addChannelNoCreds, setAddChannelNoCreds] = useState<{ type: string; name: string } | null>(null);
  const [configureChannel, setConfigureChannel] = useState<any>(null);
  const [configName, setConfigName] = useState('');
  const [configDmPolicy, setConfigDmPolicy] = useState<string>('pairing');
  const [configAllowFrom, setConfigAllowFrom] = useState('');
  const [showQRLogin, setShowQRLogin] = useState<string | null>(null);
  const [qrData, setQrData] = useState<any>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrSigningSince, setQrSigningSince] = useState<number | null>(null);
  const qrPollRef = useRef<NodeJS.Timeout | null>(null);
  const [pairingRequests, setPairingRequests] = useState<Record<string, PairingRequest[]>>({});
  const [showPairing, setShowPairing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [whatsappPreparingUntil, setWhatsappPreparingUntil] = useState<number>(0);
  const [whatsappPreparingSeconds, setWhatsappPreparingSeconds] = useState<number>(0);
  const [superchatLiveChannels, setSuperchatLiveChannels] = useState<Array<{ type: string; id: string; name?: string; inbox?: { id: string; name?: string }; url?: string }> | null>(null);
  const [superchatLiveChannelsLoading, setSuperchatLiveChannelsLoading] = useState(false);
  const [superchatLiveChannelsError, setSuperchatLiveChannelsError] = useState<string | null>(null);
  const { getToken } = useAuth();
  const t = useTranslations('agentChannels');
  const tc = useTranslations('common');

  const superchatChannel = channels.find(c => c.type === 'superchat');
  const openclawChannels = channels.filter(c => c.type !== 'superchat' && c.type !== 'webchat');

  useEffect(() => {
    params.then(p => setAgentId(p.id));
  }, [params]);

  const loadChannels = useCallback(async (isRetry = false) => {
    if (!agentId) return;
    if (isRetry) setActionLoading('retry');
    setLoadError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const [agentRes, data, liveStatusRes] = await Promise.allSettled([
        apiClient.getAgent(token, agentId),
        apiClient.getAgentChannels(token, agentId),
        apiClient.getGatewayChannelsStatus(token, agentId),
      ]);

      if (agentRes.status === 'fulfilled') setAgentStatus(agentRes.value?.agent?.status ?? null);

      if (data.status !== 'fulfilled') {
        setLoadError(t('loadError'));
        setChannels([]);
        setIsLoading(false);
        return;
      }

      let mergedChannels: ChannelStatus[] = (data.value.channels || []).map((ch: ChannelStatus) => ({ ...ch }));
      setGatewayReachable(liveStatusRes.status === 'fulfilled');

      if (liveStatusRes.status === 'fulfilled' && liveStatusRes.value?.channels && Array.isArray(liveStatusRes.value.channels)) {
        const live = liveStatusRes.value.channels;
        setLiveChannelStatus(live);
        mergedChannels = mergedChannels.map(ch => {
          const lc = live.find((l: { type: string }) => l.type === ch.type);
          if (!lc) return ch;
          const status = (lc as { connected?: boolean; status?: string }).connected
            ? 'connected' as const
            : ((lc as { status?: string }).status === 'error' ? 'error' as const : ((lc as { status?: string }).status || ch.status));
          return { ...ch, status: status as ChannelStatus['status'], errorMessage: (lc as { error?: string }).error || ch.errorMessage };
        });
      } else {
        setLiveChannelStatus(null);
      }

      setChannels(mergedChannels);
    } catch (error) {
      setLoadError(t('loadErrorGeneric'));
      setChannels([]);
    } finally {
      setIsLoading(false);
      if (isRetry) setActionLoading(null);
    }
  }, [agentId, getToken, t]);

  useEffect(() => {
    if (!agentId) return;
    loadChannels();
  }, [agentId, loadChannels]);

  useEffect(() => {
    if (!agentId || agentStatus !== 'running' || channels.length === 0) return;
    const interval = setInterval(loadChannels, 12000);
    return () => clearInterval(interval);
  }, [agentId, agentStatus, channels.length, loadChannels]);

  const loadSuperchatLiveChannels = useCallback(async () => {
    if (!agentId || !superchatChannel) return;
    setSuperchatLiveChannelsError(null);
    setSuperchatLiveChannelsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await apiClient.getSuperchatChannels(token, agentId);
      setSuperchatLiveChannels(res.channels || []);
    } catch {
      setSuperchatLiveChannelsError(t('liveChannelsError'));
      setSuperchatLiveChannels(null);
    } finally {
      setSuperchatLiveChannelsLoading(false);
    }
  }, [agentId, superchatChannel, getToken, t]);

  useEffect(() => {
    if (channelModal === 'superchat' && superchatChannel && agentId) {
      loadSuperchatLiveChannels();
    } else {
      setSuperchatLiveChannels(null);
      setSuperchatLiveChannelsError(null);
    }
  }, [channelModal, superchatChannel, agentId, loadSuperchatLiveChannels]);

  const startQRLogin = async (channel: string, relink = false) => {
    setShowQRLogin(channel);
    setQrLoading(true);
    setQrData(null);
    setQrSigningSince(null);

    try {
      const token = await getToken();
      if (!token) return;

      const result = await apiClient.startChannelLogin(token, agentId, channel, relink);
      if (result?.error) {
        const err = String(result.error);
        const is515 = err.includes('515') || err.toLowerCase().includes('restart required');
        setQrData({ message: result.error, error: result.error, status: 'error' });
        setQrLoading(false);
        showToast(is515 ? t('loginError515Hint') : t('loginError', { error: result.error }), 'error');
        return;
      }

      setQrData(result);
      setQrLoading(false);

      if (qrPollRef.current) clearInterval(qrPollRef.current);
      qrPollRef.current = setInterval(async () => {
        try {
          const statusToken = await getToken();
          if (!statusToken) return;
          const status = await apiClient.getChannelLoginStatus(statusToken, agentId, channel);
          if (status && status.status !== 'idle') {
            setQrData((prev: any) => ({ ...prev, ...status }));
            const s = (status.status || '').toLowerCase();
            const isSigning = s.includes('signing') || s.includes('linking') || s.includes('angemeldet') || s === 'pairing';
            if (isSigning) {
              setQrSigningSince((prev) => prev ?? Date.now());
            } else {
              setQrSigningSince(null);
            }
          }
          if (status?.status === 'connected' || status?.linked || status?.connected) {
            if (qrPollRef.current) clearInterval(qrPollRef.current);
            showToast(t('connectedSuccess', { channel }), 'success');
            setTimeout(() => {
              setShowQRLogin(null);
              loadChannels();
            }, 1500);
          }
          if (status?.status === 'error' || status?.error) {
            if (qrPollRef.current) clearInterval(qrPollRef.current);
            const err = String(status.error || status.message || 'Unknown error');
            const is515 = err.includes('515') || err.toLowerCase().includes('restart required');
            showToast(is515 ? t('loginError515Hint') : t('loginError', { error: err }), 'error');
          }
        } catch (pollErr) {
        }
      }, 3000);
    } catch (error: any) {
      setQrLoading(false);
      const errMsg = error?.message || error?.error || 'Failed to start login flow';
      setQrData({ message: errMsg, status: 'error' });
      showToast(errMsg, 'error');
    }
  };

  const stopQRLogin = useCallback(async () => {
    if (qrPollRef.current) {
      clearInterval(qrPollRef.current);
      qrPollRef.current = null;
    }
    const ch = showQRLogin;
    if (ch) {
      try {
        const token = await getToken();
        if (token) await apiClient.stopChannelLogin(token, agentId, ch).catch(() => {});
      } catch { /* best effort */ }
    }
    setShowQRLogin(null);
    setQrData(null);
    setQrSigningSince(null);
  }, [agentId, getToken, showQRLogin]);

  useEffect(() => {
    return () => {
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (whatsappPreparingUntil <= 0) {
      setWhatsappPreparingSeconds(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((whatsappPreparingUntil - Date.now()) / 1000));
      setWhatsappPreparingSeconds(left);
      if (left <= 0) setWhatsappPreparingUntil(0);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [whatsappPreparingUntil]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showQRLogin) stopQRLogin();
      else if (addChannelNoCreds) setAddChannelNoCreds(null);
      else if (showPairing) setShowPairing(false);
      else if (configureChannel) setConfigureChannel(null);
      else if (addChannelCreds) {
        const type = addChannelCreds.type;
        setAddChannelCreds(null);
        setCredForm({});
        setShowAddChannel(false);
        setChannelModal(type === 'superchat' ? 'superchat' : 'openclaw');
      } else if (showAddChannel) { setShowAddChannel(false); setChannelModal('openclaw'); }
      else if (channelModal) setChannelModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [channelModal, showAddChannel, addChannelCreds, addChannelNoCreds, configureChannel, showQRLogin, showPairing, stopQRLogin]);

  const loadPairingRequests = useCallback(async () => {
    const token = await getToken();
    if (!token || !agentId) return;

    const results: Record<string, PairingRequest[]> = {};
    for (const ch of channels) {
      if (PAIRING_CHANNELS.includes(ch.type)) {
        try {
          const data = await apiClient.listPairingRequests(token, agentId, ch.type);
          if (data.requests && data.requests.length > 0) {
            results[ch.type] = data.requests;
          }
        } catch { /* Channel may not support pairing */ }
      }
    }
    setPairingRequests(results);
  }, [agentId, channels, getToken]);

  useEffect(() => {
    if (channels.length > 0) loadPairingRequests();
  }, [channels, loadPairingRequests]);

  const handleApprovePairing = async (channel: string, code: string) => {
    setActionLoading(`approve:${channel}:${code}`);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.approvePairing(token, agentId, channel, code);
      showToast(t('pairingApproved'), 'success');
      loadPairingRequests();
    } catch {
      showToast(t('failedApprove'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectPairing = async (channel: string, code: string) => {
    setActionLoading(`reject:${channel}:${code}`);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.rejectPairing(token, agentId, channel, code);
      showToast(t('pairingRejected'), 'success');
      loadPairingRequests();
    } catch {
      showToast(t('failedReject'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const totalPairingRequests = Object.values(pairingRequests).reduce((sum, arr) => sum + arr.length, 0);

  const handleDisconnect = async (channelType: string) => {
    setActionLoading(`disconnect:${channelType}`);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.removeAgentChannel(token, agentId, channelType);
      showToast(t('channelDisconnected'), 'success');
      loadChannels();
    } catch {
      showToast(t('failedDisconnect'), 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatTime = (date: string) => {
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const openSuperchatConnect = () => {
    setChannelModal(null);
    setAddChannelCreds({ type: SUPERCHAT_CHANNEL.type, name: SUPERCHAT_CHANNEL.name, credFields: SUPERCHAT_CHANNEL.credFields });
    setCredForm({});
  };

  const openSuperchatManage = () => {
    if (!superchatChannel) return;
    setConfigureChannel(superchatChannel);
    setConfigName(superchatChannel.name || superchatChannel.type);
    setConfigDmPolicy(superchatChannel.dmPolicy || 'pairing');
    setConfigAllowFrom(Array.isArray(superchatChannel.allowFrom) ? superchatChannel.allowFrom.join(', ') : '');
  };

  return (
    <AppShell embedded>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium">{t('title')}</h1>
          {liveChannelStatus && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs border border-green-300/80 dark:border-green-800/80 text-green-700 dark:text-green-400 bg-green-50/80 dark:bg-green-950/50">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {t('liveStatus')}
            </span>
          )}
        </div>
      </div>

      {totalPairingRequests > 0 && (
        <div className="box-alert mb-4 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-medium text-amber-800 dark:text-amber-200">{t('pendingPairing', { count: totalPairingRequests })}</h4>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{t('pendingPairingDesc')}</p>
            </div>
            <button
              onClick={() => setShowPairing(true)}
              className="btn-secondary"
            >
              {t('review')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {loadError && (
          <div className="rounded-xl p-3 border border-red-200/80 dark:border-red-900/50 bg-red-50/80 dark:bg-red-950/30">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p>
              <button
                onClick={() => loadChannels(true)}
                disabled={actionLoading === 'retry'}
                className="btn-secondary shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {actionLoading === 'retry' ? tc('loading') : tc('retry')}
              </button>
            </div>
          </div>
        )}

        {!loadError && gatewayReachable === false && agentStatus === 'running' && channels.length > 0 && (
          <div className="box-alert px-3 py-2">
            {t('liveStatusUnavailable')}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col sm:flex-row gap-3">
            {[1, 2].map((i) => (
              <div key={i} className={`box-modal sm:flex-1 p-4 animate-pulse`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-border" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-20 rounded bg-border" />
                    <div className="h-3 w-full rounded bg-border" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setChannelModal('superchat')}
              className={`box-modal sm:flex-1 p-4 text-left transition-all duration-200 hover:border-border hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] group`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-border/80 flex items-center justify-center shrink-0 overflow-hidden p-1.5 bg-muted/30">
                  <img src="/logos/superchat.svg" alt="Superchat" className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">{t('superchatLabel')}</h3>
                    {superchatChannel && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t('superchatDesc')}</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setChannelModal('openclaw')}
              className={`box-modal sm:flex-1 p-4 text-left transition-all duration-200 hover:border-border hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] group`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl border border-border/80 flex items-center justify-center shrink-0 overflow-hidden p-1.5 bg-muted/30">
                  <img src="/logos/openclaw.svg" alt="OpenClaw" className="w-full h-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">{t('openclawLabel')}</h3>
                    {openclawChannels.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {openclawChannels.length} {t('configured')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t('openclawDesc')}</p>
                </div>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* ── Superchat Modal ───────────────────────────────────────────── */}
      {channelModal === 'superchat' && (
        <div className={MODAL_OVERLAY} onClick={() => setChannelModal(null)} role="dialog" aria-modal="true" aria-labelledby="superchat-modal-title">
          <div className={`box-modal w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader
              title={t('superchatLabel')}
              subtitle={t('superchatDesc')}
              icon={<ChannelLogo src="/logos/superchat.svg" alt="Superchat" />}
              onClose={() => setChannelModal(null)}
            />
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {!superchatChannel ? (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('superchatConnectHint')}
                  </p>
                  <button onClick={openSuperchatConnect} className="w-full btn-primary-sm py-2.5">
                    {t('processToConnect')}
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">{t('configured')}</h4>
                    <div className="box p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ChannelLogo src="/logos/superchat.svg" alt="Superchat" />
                        <div>
                          <p className="font-medium text-sm">{superchatChannel.name || 'Superchat'}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-xs text-muted-foreground capitalize">{superchatChannel.status}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={openSuperchatManage} className="btn-ghost-sm">
                          {t('manage')}
                        </button>
                        <button
                          onClick={() => handleDisconnect('superchat')}
                          disabled={actionLoading === 'disconnect:superchat'}
                          className="btn-ghost-sm text-red-600 disabled:opacity-60"
                        >
                          {actionLoading === 'disconnect:superchat' ? tc('loading') : t('disconnect')}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">{t('liveChannelsTitle')}</h4>
                    {superchatLiveChannelsLoading ? (
                      <p className="text-xs text-muted-foreground">{t('liveChannelsLoading')}</p>
                    ) : superchatLiveChannelsError ? (
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-red-600 dark:text-red-400">{superchatLiveChannelsError}</p>
                        <button onClick={loadSuperchatLiveChannels} className="text-xs text-red-600 dark:text-red-400 hover:underline">{tc('retry')}</button>
                      </div>
                    ) : superchatLiveChannels && superchatLiveChannels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {superchatLiveChannels.map((ch) => (
                          <span key={ch.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted/60 text-muted-foreground">
                            <ChannelIcon channel={ch.type === 'whats_app' ? 'whatsapp' : ch.type === 'mail' ? 'email' : ch.type === 'livechat' ? 'webchat' : ch.type} size={12} />
                            {ch.name || ch.inbox?.name || ch.type.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('liveChannelsEmpty')}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── OpenClaw Modal ───────────────────────────────────────────── */}
      {channelModal === 'openclaw' && (
        <div className={MODAL_OVERLAY} onClick={() => setChannelModal(null)} role="dialog" aria-modal="true" aria-labelledby="openclaw-modal-title">
          <div className={`box-modal w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader
              title={t('openclawLabel')}
              subtitle={t('openclawDesc')}
              icon={<ChannelLogo src="/logos/openclaw.svg" alt="OpenClaw" />}
              onClose={() => setChannelModal(null)}
            />
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">{t('configured')}</h4>
                {openclawChannels.length > 0 ? (
                  <div className="space-y-2">
                    {openclawChannels.map((channel) => {
                      const channelMeta = OPENCLAW_CHANNELS.find(ac => ac.type === channel.type);
                      const supportsQR = channelMeta && 'supportsQR' in channelMeta && channelMeta.supportsQR;
                      const channelPairing = pairingRequests[channel.type];
                      return (
                        <div key={channel._id || channel.type} className="rounded-xl border border-gray-200/80 dark:border-border/60 p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg border border-gray-200/80 dark:border-border/60 flex items-center justify-center bg-gray-50/50 dark:bg-card/30">
                              <ChannelIcon channel={channel.type} size={20} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{channel.name || channel.type}</p>
                                {channelMeta && 'beta' in channelMeta && Boolean(channelMeta.beta) && (
                                  <span className="inline-flex rounded-full px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">{String(t('beta'))}</span>
                                )}
                                {channelPairing && channelPairing.length > 0 && (
                                  <span className="inline-flex rounded-full px-1.5 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">{channelPairing.length} {String(t('pending'))}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${channel.status === 'connected' ? 'bg-green-500' : channel.status === 'error' ? 'bg-red-500' : 'bg-gray-400 dark:bg-muted'}`} />
                                <span className="text-xs text-muted-foreground capitalize">{channel.status}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {supportsQR && channel.status !== 'connected' && (
                              <button
                                onClick={() => startQRLogin(channel.type)}
                                disabled={channel.type === 'whatsapp' && whatsappPreparingSeconds > 0}
                                className="btn-secondary disabled:opacity-60"
                              >
                                {channel.type === 'whatsapp' && whatsappPreparingSeconds > 0 ? t('whatsappPreparingWithCountdown', { seconds: whatsappPreparingSeconds }) : t('linkQr')}
                              </button>
                            )}
                            {channelPairing && channelPairing.length > 0 && PAIRING_CHANNELS.includes(channel.type) && (
                              <button onClick={() => setShowPairing(true)} className="btn-secondary">
                                {t('approve')} ({channelPairing.length})
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setConfigureChannel(channel);
                                setConfigName(channel.name || channel.type);
                                setConfigDmPolicy(channel.dmPolicy || 'pairing');
                                setConfigAllowFrom(Array.isArray(channel.allowFrom) ? channel.allowFrom.join(', ') : '');
                              }}
                              className="btn-ghost-sm"
                            >
                              {t('manage')}
                            </button>
                            {channel.type !== 'webchat' && (
                              <button
                                onClick={() => handleDisconnect(channel.type)}
                                disabled={actionLoading === `disconnect:${channel.type}`}
                                className="btn-ghost-sm text-red-600 disabled:opacity-60"
                              >
                                {actionLoading === `disconnect:${channel.type}` ? tc('loading') : t('disconnect')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">{t('noChannels')}</p>
                )}
              </div>

              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">{t('available')}</h4>
                {(() => {
                  const available = OPENCLAW_CHANNELS.filter(ac => !channels.find(c => c.type === ac.type));
                  if (available.length === 0) {
                    return <p className="text-xs text-muted-foreground py-2">{t('allChannelsConnected')}</p>;
                  }
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {available.map(ac => (
                        <button
                          key={ac.type}
                          disabled={!!actionLoading}
                          className="box flex flex-col items-center gap-2 p-3 hover:bg-muted/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          onClick={() => {
                            if (ac.needsCredentials && ac.credFields) {
                              setChannelModal(null);
                              setAddChannelCreds({ type: ac.type, name: ac.name, credFields: ac.credFields });
                              setCredForm({});
                              setAddChannelDmPolicy('pairing');
                            } else if (PAIRING_CHANNELS.includes(ac.type)) {
                              setAddChannelNoCreds({ type: ac.type, name: ac.name });
                              setAddChannelDmPolicy('pairing');
                            } else {
                              setActionLoading(`add:${ac.type}`);
                              (async () => {
                                try {
                                  const token = await getToken();
                                  if (!token) return;
                                  await apiClient.addAgentChannel(token, agentId, { type: ac.type });
                                  showToast(t('channelAdded', { channel: ac.name }), 'success');
                                  loadChannels();
                                } catch {
                                  showToast(t('failedAddChannel'), 'error');
                                } finally {
                                  setActionLoading(null);
                                }
                              })();
                            }
                          }}
                        >
                          <div className="w-10 h-10 rounded-lg border border-gray-200/80 dark:border-border/60 flex items-center justify-center bg-gray-50/50 dark:bg-card/30">
                            <ChannelIcon channel={ac.type} size={22} />
                          </div>
                          <span className="font-medium text-xs text-center">{ac.name}</span>
                          {ac.needsCredentials && <span className="text-xs text-muted-foreground">{t('needsApiCredentials')}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Channel Modal (standalone, opened from OpenClaw) */}
      {showAddChannel && (
        <div className={MODAL_OVERLAY} onClick={() => { setShowAddChannel(false); setChannelModal('openclaw'); }} role="dialog" aria-modal="true">
          <div className={`box-modal w-full max-w-2xl max-h-[85vh] flex flex-col`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={t('addChannelTitle')} subtitle={t('addChannelDesc')} onClose={() => { setShowAddChannel(false); setChannelModal('openclaw'); }} />
            <div className="flex-1 overflow-y-auto p-5">
              {(() => {
                const available = OPENCLAW_CHANNELS.filter(ac => !channels.find(c => c.type === ac.type));
                if (available.length === 0) {
                  return <p className="text-xs text-muted-foreground text-center py-12">{t('allChannelsConnected')}</p>;
                }
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {available.map(ac => (
                      <button
                        key={ac.type}
                        disabled={!!actionLoading}
                        className="box group flex flex-col items-center gap-2 p-4 hover:bg-muted/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => {
                          if (ac.needsCredentials && ac.credFields) {
                            setAddChannelCreds({ type: ac.type, name: ac.name, credFields: ac.credFields });
                            setCredForm({});
                            setAddChannelDmPolicy('pairing');
                            setShowAddChannel(false);
                          } else if (PAIRING_CHANNELS.includes(ac.type)) {
                            setAddChannelNoCreds({ type: ac.type, name: ac.name });
                            setAddChannelDmPolicy('pairing');
                            setShowAddChannel(false);
                          } else {
                            setActionLoading(`add:${ac.type}`);
                            (async () => {
                              try {
                                const token = await getToken();
                                if (!token) return;
                                await apiClient.addAgentChannel(token, agentId, { type: ac.type });
                                showToast(t('channelAdded', { channel: ac.name }), 'success');
                                setShowAddChannel(false);
                                setChannelModal('openclaw');
                                loadChannels();
                              } catch {
                                showToast(t('failedAddChannel'), 'error');
                              } finally {
                                setActionLoading(null);
                              }
                            })();
                          }
                        }}
                      >
                        <div className="w-10 h-10 rounded-lg border border-gray-200/80 dark:border-border/60 flex items-center justify-center bg-gray-50/50 dark:bg-card/30 group-hover:border-gray-300 dark:group-hover:border-gray-600 transition-colors">
                          <ChannelIcon channel={ac.type} size={22} />
                        </div>
                        <span className="font-medium text-xs">{ac.name}</span>
                        {ac.needsCredentials && <span className="text-xs text-muted-foreground">{t('needsApiCredentials')}</span>}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Add Channel with Credentials Modal */}
      {addChannelCreds && (
        <div className={MODAL_OVERLAY} onClick={() => { setAddChannelCreds(null); setCredForm({}); setShowAddChannel(false); setChannelModal(addChannelCreds.type === 'superchat' ? 'superchat' : 'openclaw'); }} role="dialog" aria-modal="true">
          <div className={`box-modal max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={`${addChannelCreds.name} — ${t('credentialsTitle')}`} subtitle={t('credentialsDesc')} onClose={() => { setAddChannelCreds(null); setCredForm({}); setShowAddChannel(false); setChannelModal(addChannelCreds.type === 'superchat' ? 'superchat' : 'openclaw'); }} />
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {(addChannelCreds.credFields || []).map(field => (
                <div key={field} className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{(t as (k: string) => string)(`credField.${field}`) || field}</label>
                  <textarea
                    value={credForm[field] || ''}
                    onChange={e => setCredForm(prev => ({ ...prev, [field]: e.target.value }))}
                    className="input font-mono text-xs min-h-[60px] rounded-lg"
                    placeholder={field}
                    rows={field === 'serviceAccountKey' ? 6 : 2}
                  />
                </div>
              ))}
              {PAIRING_CHANNELS.includes(addChannelCreds.type) && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{t('dmPolicy')}</label>
                  <select value={addChannelDmPolicy} onChange={e => setAddChannelDmPolicy(e.target.value)} className="input text-xs rounded-lg w-full">
                    <option value="pairing">{t('dmPolicyPairing')}</option>
                    <option value="allowlist">{t('dmPolicyAllowlist')}</option>
                    <option value="open">{t('dmPolicyOpen')}</option>
                    <option value="disabled">{t('dmPolicyDisabled')}</option>
                  </select>
                </div>
              )}
              <button
                disabled={actionLoading === 'addChannel'}
                onClick={async () => {
                  setActionLoading('addChannel');
                  try {
                    const token = await getToken();
                    if (!token) return;
                    const creds: Record<string, string> = {};
                    const optional = ['appToken', ...(addChannelCreds.type === 'msteams' ? ['tenantId'] : [])];
                    for (const f of addChannelCreds.credFields || []) {
                      const v = credForm[f]?.trim();
                      if (v) creds[f] = v;
                      else if (!optional.includes(f)) {
                        showToast(t('pleaseEnterField', { field: f }), 'error');
                        setActionLoading(null);
                        return;
                      }
                    }
                    await apiClient.addAgentChannel(token, agentId, { type: addChannelCreds.type, credentials: creds, dmPolicy: addChannelDmPolicy as 'pairing' | 'allowlist' | 'open' | 'disabled' });
                    showToast(t('channelAdded', { channel: addChannelCreds.name }), 'success');
                    const addedType = addChannelCreds.type;
                    setAddChannelCreds(null);
                    setCredForm({});
                    setChannelModal(addedType === 'superchat' ? 'superchat' : 'openclaw');
                    loadChannels();
                  } catch {
                    showToast(t('failedAddChannel'), 'error');
                  } finally {
                    setActionLoading(null);
                  }
                }}
                className="btn-primary-sm w-full disabled:opacity-60 disabled:cursor-not-allowed"
              >{actionLoading === 'addChannel' ? tc('loading') : t('add')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Configure Channel Modal */}
      {configureChannel && (
        <div className={MODAL_OVERLAY} onClick={() => setConfigureChannel(null)} role="dialog" aria-modal="true">
          <div className={`box-modal max-w-md w-full max-h-[85vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={t('configureTitle', { channel: configureChannel.name || configureChannel.type })} subtitle={t('configureDesc')} onClose={() => setConfigureChannel(null)} />
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('channelName')}</label>
                <input type="text" value={configName} onChange={(e) => setConfigName(e.target.value)} className="input rounded-lg" />
              </div>
              {configureChannel.type !== 'webchat' && configureChannel.type !== 'superchat' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">{t('dmPolicy')}</label>
                    <select value={configDmPolicy} onChange={e => setConfigDmPolicy(e.target.value)} className="input text-xs rounded-lg">
                      <option value="pairing">{t('dmPolicyPairing')}</option>
                      <option value="allowlist">{t('dmPolicyAllowlist')}</option>
                      <option value="open">{t('dmPolicyOpen')}</option>
                      <option value="disabled">{t('dmPolicyDisabled')}</option>
                    </select>
                  </div>
                  {configDmPolicy === 'allowlist' && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">{t('allowlistIds')}</label>
                      <input type="text" value={configAllowFrom} onChange={e => setConfigAllowFrom(e.target.value)} className="input font-mono text-xs rounded-lg" placeholder={t('allowlistPlaceholder')} />
                    </div>
                  )}
                </>
              )}
              {configureChannel.type === 'superchat' && (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{t('superchatWebhookUrl')}</label>
                  <code className="block text-xs bg-secondary/50 px-3 py-2 rounded-lg font-mono break-all border border-gray-200/80 dark:border-border/60">
                    {typeof window !== 'undefined' ? (() => {
                      const base = (process.env.NEXT_PUBLIC_API_URL || window.location.origin || '').replace(/\/$/, '');
                      const path = base.endsWith('/api') ? '/webhooks/superchat/' : '/api/webhooks/superchat/';
                      return base + path + agentId;
                    })() : '…'}
                  </code>
                </div>
              )}
              <div className="flex items-center gap-3 py-1">
                <span className="text-xs text-muted-foreground">{tc('status')}</span>
                <span className={`w-1.5 h-1.5 rounded-full ${configureChannel.status === 'connected' ? 'bg-green-500' : 'bg-gray-400 dark:bg-muted'}`} />
                <span className="text-xs capitalize">{configureChannel.status}</span>
                {configureChannel.metrics && (
                  <span className="text-xs text-muted-foreground ml-auto">{configureChannel.metrics.totalMessages || 0} {tc('messages')}</span>
                )}
              </div>
              <button
                disabled={actionLoading === 'saveConfig'}
                onClick={async () => {
                  setActionLoading('saveConfig');
                  try {
                    const token = await getToken();
                    if (!token) return;
                    const updates: { dmPolicy?: string; allowFrom?: string[] } = {};
                    if (configureChannel.type !== 'webchat' && configureChannel.type !== 'superchat') {
                      updates.dmPolicy = configDmPolicy;
                      if (configDmPolicy === 'allowlist' && configAllowFrom.trim()) {
                        updates.allowFrom = configAllowFrom.split(',').map((s: string) => s.trim()).filter(Boolean);
                      }
                      if (configDmPolicy === 'open') updates.allowFrom = ['*'];
                    }
                    await apiClient.updateAgentChannel(token, agentId, configureChannel.type, updates);
                    showToast(t('channelConfigSaved'), 'success');
                    setConfigureChannel(null);
                    loadChannels();
                  } catch {
                    showToast(t('failedSaveConfig'), 'error');
                  } finally {
                    setActionLoading(null);
                  }
                }}
                className="btn-primary-sm w-full disabled:opacity-60 disabled:cursor-not-allowed"
              >{actionLoading === 'saveConfig' ? tc('saving') : tc('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Channel (no credentials) Modal — DM Policy selection for WhatsApp etc. */}
      {addChannelNoCreds && (
        <div className={MODAL_OVERLAY} onClick={() => setAddChannelNoCreds(null)} role="dialog" aria-modal="true">
          <div className={`box-modal max-w-sm w-full flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={`${t('addChannelTitle')} — ${addChannelNoCreds.name}`} onClose={() => setAddChannelNoCreds(null)} />
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">{t('dmPolicy')}</label>
                <select value={addChannelDmPolicy} onChange={e => setAddChannelDmPolicy(e.target.value)} className="input text-xs rounded-lg w-full">
                  <option value="pairing">{t('dmPolicyPairing')}</option>
                  <option value="allowlist">{t('dmPolicyAllowlist')}</option>
                  <option value="open">{t('dmPolicyOpen')}</option>
                  <option value="disabled">{t('dmPolicyDisabled')}</option>
                </select>
              </div>
              <button
                disabled={actionLoading === `add:${addChannelNoCreds.type}`}
                onClick={async () => {
                  setActionLoading(`add:${addChannelNoCreds.type}`);
                  try {
                    const token = await getToken();
                    if (!token) return;
                    await apiClient.addAgentChannel(token, agentId, { type: addChannelNoCreds.type, dmPolicy: addChannelDmPolicy as 'pairing' | 'allowlist' | 'open' | 'disabled' });
                    showToast(t('channelAdded', { channel: addChannelNoCreds.name }), 'success');
                    if (addChannelNoCreds.type === 'whatsapp') {
                      setWhatsappPreparingUntil(Date.now() + 15000);
                      showToast(t('whatsappPreparingToast'), 'info');
                    }
                    setAddChannelNoCreds(null);
                    loadChannels();
                  } catch {
                    showToast(t('failedAddChannel'), 'error');
                  } finally {
                    setActionLoading(null);
                  }
                }}
                className="btn-primary-sm w-full disabled:opacity-60 disabled:cursor-not-allowed"
              >{actionLoading === `add:${addChannelNoCreds.type}` ? tc('loading') : t('add')}</button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Login Modal — clean, minimal */}
      {showQRLogin && (
        <div className={MODAL_OVERLAY} onClick={stopQRLogin} role="dialog" aria-modal="true">
          <div className={`box-modal max-w-sm w-full flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={t('linkTitle', { channel: showQRLogin })} onClose={stopQRLogin} />
            <div className="p-5">
              <div className="flex flex-col items-center justify-center min-h-[180px] gap-4">
                {qrLoading ? (
                  <p className="text-xs text-muted-foreground">{t('generatingQr')}</p>
                ) : qrData?.status === 'connected' || qrData?.linked ? (
                  <p className="text-sm text-green-600 dark:text-green-400">{t('linkedSuccessfully', { channel: showQRLogin })}</p>
                ) : qrData?.status === 'error' ? (
                  <div className="text-center space-y-3">
                    <p className="text-xs text-red-500">{(qrData?.error || qrData?.message || '').toString().includes('515') || (qrData?.error || qrData?.message || '').toString().toLowerCase().includes('restart required') ? t('linkFailed515') : t('linkFailed')}</p>
                    <button onClick={() => startQRLogin(showQRLogin, true)} className="btn-secondary">{t('relink')}</button>
                  </div>
                ) : qrData?.qr || qrData?.qrCode || qrData?.qrDataUrl || qrData?.code ? (
                  <div className="flex flex-col items-center gap-3">
                    {(() => {
                      const qrValue = qrData.qrDataUrl || qrData.qr || qrData.qrCode;
                      if (!qrValue) return null;
                      if (typeof qrValue === 'string' && (qrValue.startsWith('data:image') || qrValue.startsWith('http'))) {
                        return <div className="box p-3"><img src={qrValue} alt="QR" className="w-40 h-40" /></div>;
                      }
                      return <div className="box p-3"><pre className="text-xs font-mono leading-none whitespace-pre select-all">{qrValue}</pre></div>;
                    })()}
                    {qrData.code && <p className="text-sm font-mono font-semibold tracking-wider">{qrData.code}</p>}
                    <p className="text-xs text-muted-foreground">{t('scanWhatsApp')}</p>
                    {(qrSigningSince && Date.now() - qrSigningSince > 90_000) && (
                      <button onClick={() => startQRLogin(showQRLogin!, true)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">{t('relink')}</button>
                    )}
                  </div>
                ) : (qrData?.message || '').toLowerCase().includes('already linked') ? (
                  <div className="text-center space-y-3">
                    <p className="text-xs text-muted-foreground">{qrData?.message}</p>
                    <button onClick={() => startQRLogin(showQRLogin!, true)} className="btn-secondary">{t('relink')}</button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{qrData?.message || t('waitingForQr')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pairing Requests Modal */}
      {showPairing && (
        <div className={MODAL_OVERLAY} onClick={() => setShowPairing(false)} role="dialog" aria-modal="true">
          <div className={`box-modal max-w-md w-full max-h-[80vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
            <ModalHeader title={t('pairingRequests')} subtitle={t('pairingRequestsDesc')} onClose={() => setShowPairing(false)} />
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {Object.entries(pairingRequests).map(([channel, requests]) => (
                <div key={channel} className="space-y-2">
                  <h3 className="text-xs font-mono uppercase text-muted-foreground tracking-wider">{channel} ({requests.length})</h3>
                  {requests.map((req) => (
                    <div key={req.code} className="rounded-xl border border-gray-200/80 dark:border-border/60 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div><span className="text-sm font-mono font-medium">{req.code}</span>{req.sender && <p className="text-xs text-muted-foreground mt-0.5">{t('from')}: {req.sender}</p>}</div>
                        {req.expiresAt && <span className="text-xs text-muted-foreground">{t('expires')} {formatTime(req.expiresAt)}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleApprovePairing(channel, req.code)} disabled={actionLoading === `approve:${channel}:${req.code}`} className="btn-secondary flex-1 disabled:opacity-60">{actionLoading === `approve:${channel}:${req.code}` ? tc('loading') : t('approve')}</button>
                        <button onClick={() => handleRejectPairing(channel, req.code)} disabled={actionLoading === `reject:${channel}:${req.code}`} className="btn-ghost-sm flex-1 text-red-600 disabled:opacity-60">{actionLoading === `reject:${channel}:${req.code}` ? tc('loading') : t('reject')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {totalPairingRequests === 0 && <div className="text-center py-8 text-muted-foreground text-xs">{t('noPendingRequests')}</div>}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
