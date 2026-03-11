"use client";

import { motion } from "motion/react";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";

interface AgentOption {
  id: string;
  name: string;
}

interface DailyRow {
  date: string;
  messages: number;
  cost: number;
  tokens: number;
}

interface ModelRow {
  model: string;
  messages: number;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  percentage: number;
}

interface UsageData {
  totalCost: number;
  totalTokens: number;
  totalMessages: number;
  activeAgents: number;
  daily: DailyRow[];
}

export default function AnalyticsPage() {
  const { getToken } = useAuth();
  const t = useTranslations("analytics");

  const [loading, setLoading] = useState(true);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [modelData, setModelData] = useState<ModelRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  // Export state
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    loadData();
  }, [selectedAgentId]);

  const loadAgents = async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getAgents(token);
      if (data?.agents) {
        setAgents(data.agents.map((a: any) => ({ id: a.id || a._id || "", name: a.name })));
      }
    } catch {
      // silent
    }
  };

  const loadData = async () => {
    try {
      const token = await getToken();
      if (!token) { setLoading(false); return; }
      const params = selectedAgentId ? { agentId: selectedAgentId } : undefined;
      const [overview, models] = await Promise.allSettled([
        apiClient.getUsageAnalytics(token, params),
        apiClient.getModelBreakdown(token, params),
      ]);
      if (overview.status === "fulfilled") setUsageData(overview.value);
      if (models.status === "fulfilled") setModelData(models.value.models || models.value || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const token = await getToken();
      if (!token) return;
      const blob = await apiClient.exportUsageData(token, {
        from: exportFrom,
        to: exportTo,
        format: exportFormat,
        ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openclaw-business-usage-${exportFrom}-${exportTo}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded>
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium mb-1">Analytics</h1>
            <p className="text-xs text-muted-foreground">
              Usage overview and cost tracking across all agents.
            </p>
          </div>
          {agents.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="agent-filter" className="text-xs text-muted-foreground whitespace-nowrap">
                Agent:
              </label>
              <select
                id="agent-filter"
                value={selectedAgentId}
                onChange={(e) => { setSelectedAgentId(e.target.value); setLoading(true); }}
                className="input text-xs font-mono min-w-[140px]"
              >
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-5">
            <div className="section-header mb-2">Total Cost</div>
            <div className="text-2xl font-mono font-medium">€{(usageData?.totalCost ?? 0).toFixed(2)}</div>
          </div>
          <div className="card p-5">
            <div className="section-header mb-2">Messages</div>
            <div className="text-2xl font-mono font-medium">{(usageData?.totalMessages ?? 0).toLocaleString()}</div>
          </div>
          <div className="card p-5">
            <div className="section-header mb-2">Tokens</div>
            <div className="text-2xl font-mono font-medium">{(usageData?.totalTokens ?? 0).toLocaleString()}</div>
          </div>
          <div className="card p-5">
            <div className="section-header mb-2">Active Agents</div>
            <div className="text-2xl font-mono font-medium">{(usageData?.activeAgents ?? 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Model Usage */}
        {modelData.length > 0 && (
          <div>
            <h2 className="section-header mb-4">Cost by Model</h2>
            <div className="space-y-2">
              {[...modelData].sort((a, b) => b.cost - a.cost).map((row, i) => (
                <motion.div
                  key={row.model}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="card p-4 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{row.model}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {row.messages.toLocaleString()} messages
                    </div>
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-foreground transition-all duration-500 rounded-full"
                        style={{ width: `${Math.min(row.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs font-mono font-medium w-20 text-right shrink-0">
                    €{row.cost.toFixed(2)}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground w-12 text-right shrink-0">
                    {row.percentage.toFixed(0)}%
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Daily Breakdown */}
        <div>
          <h2 className="section-header mb-4">Daily Breakdown</h2>
          <div className="rounded-xl border border-border overflow-x-auto overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left px-4 py-2 font-mono uppercase tracking-wider text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-2 font-mono uppercase tracking-wider text-muted-foreground">Messages</th>
                  <th className="text-right px-4 py-2 font-mono uppercase tracking-wider text-muted-foreground">Cost</th>
                  <th className="text-right px-4 py-2 font-mono uppercase tracking-wider text-muted-foreground">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(usageData?.daily ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No data available</td>
                  </tr>
                ) : (
                  usageData!.daily.map((row, i) => (
                    <motion.tr
                      key={row.date}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="border-b border-border/60 hover:bg-gray-50 dark:hover:bg-background transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono">{row.date}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.messages.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-mono">€{row.cost.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.tokens.toLocaleString()}</td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Export */}
        <div className="card p-6">
          <h2 className="section-header mb-5">Export</h2>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="input font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="input font-mono text-xs" />
            </div>
            <div className="flex gap-0">
              <button
                onClick={() => setExportFormat("csv")}
                className={`px-3 py-2 text-xs font-mono uppercase tracking-wider rounded-l-lg border transition-colors ${
                  exportFormat === "csv"
                    ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                    : "text-gray-500 border-border hover:text-foreground"
                }`}
              >CSV</button>
              <button
                onClick={() => setExportFormat("json")}
                className={`px-3 py-2 text-xs font-mono uppercase tracking-wider rounded-r-lg border border-l-0 transition-colors ${
                  exportFormat === "json"
                    ? "bg-foreground text-primary-foreground border-black dark:border-foreground"
                    : "text-gray-500 border-border hover:text-foreground"
                }`}
              >JSON</button>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || !exportFrom || !exportTo}
              className="btn-primary-sm px-5 font-mono uppercase tracking-wider disabled:opacity-50"
            >
              {exporting ? "..." : "Download"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
