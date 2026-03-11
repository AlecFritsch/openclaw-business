"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { ChannelIcon } from "@/components/channel-icon";
import { Plug } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";

interface Props {
  agentId: string;
  agentName: string;
  channels: { type: string; status: string }[];
  suggestMcpConnections?: { mcpUrl: string; mcpName: string }[];
  onDismiss: () => void;
}

export function AgentSetupChecklist({ agentId, agentName, channels, suggestMcpConnections, onDismiss }: Props) {
  const { getToken } = useAuth();
  const t = useTranslations('builder');
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [connectingMcp, setConnectingMcp] = useState<string | null>(null);

  const pendingChannels = channels.filter(ch => ch.status === 'pending');
  const mcps = suggestMcpConnections || [];

  const handleMcpConnect = async (mcp: { mcpUrl: string; mcpName: string }) => {
    try {
      setConnectingMcp(mcp.mcpUrl);
      const token = await getToken();
      if (!token) return;
      const result = await apiClient.smitheryConnect(token, { mcpUrl: mcp.mcpUrl, mcpName: mcp.mcpName });
      if (result.status === 'auth_required' && result.authorizationUrl) {
        window.open(result.authorizationUrl, '_blank', 'width=500,height=600');
      } else {
        showToast(`${mcp.mcpName} connected`, 'success');
        setConnected(prev => new Set(prev).add(`mcp:${mcp.mcpUrl}`));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connection failed', 'error');
    } finally {
      setConnectingMcp(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card space-y-5">
      <div>
        <h2 className="text-base font-medium">{agentName} {t('setupLive')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('setupSubtitle')}</p>
      </div>

      {pendingChannels.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('setupChannels')}</h3>
          <div className="space-y-2">
            {pendingChannels.map((ch, i) => {
              const done = ch.status === "connected" || ch.status === "running";
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
                  <ChannelIcon channel={ch.type} size={18} />
                  <span className="flex-1 text-sm capitalize">{ch.type}</span>
                  {done ? (
                    <span className="text-xs text-muted-foreground">✓ {t('setupDone')}</span>
                  ) : (
                    <button
                      onClick={() => {
                        window.open(`/agents/${agentId}/channels`, '_blank');
                      }}
                      className="btn-primary-sm"
                    >
                      {t('setupConnect')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mcps.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('setupIntegrations')}</h3>
          <div className="space-y-2">
            {mcps.map((mcp, i) => {
              const done = connected.has(`mcp:${mcp.mcpUrl}`);
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
                  <Plug size={18} className="text-muted-foreground" />
                  <span className="flex-1 text-sm">{mcp.mcpName}</span>
                  {done ? (
                    <span className="text-xs text-muted-foreground">✓ {t('setupDone')}</span>
                  ) : (
                    <button
                      onClick={() => handleMcpConnect(mcp)}
                      disabled={connectingMcp === mcp.mcpUrl}
                      className="btn-primary-sm disabled:opacity-50"
                    >
                      {connectingMcp === mcp.mcpUrl ? '...' : t('setupAuthorize')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2.5 pt-1">
        <button
          onClick={() => window.location.assign(`/agents/${agentId}/workspace`)}
          className="btn-primary-sm px-4 flex-1"
        >
          {t('setupOpenWorkspace')}
        </button>
        <button onClick={onDismiss} className="btn-ghost-sm px-4">
          {t('setupSkip')}
        </button>
      </div>
    </motion.div>
  );
}
