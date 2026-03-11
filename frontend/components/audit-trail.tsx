"use client";

import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";

const RISK_COLORS: Record<string, string> = {
  low: "bg-border text-gray-700 dark:text-muted-foreground",
  medium: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  high: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  critical: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
};

const OUTCOME_COLORS: Record<string, string> = {
  success: "text-green-600 dark:text-green-400",
  failure: "text-red-600 dark:text-red-400",
  denied: "text-orange-600 dark:text-orange-400",
  partial: "text-amber-600 dark:text-amber-400",
  pending: "text-muted-foreground",
};

const CATEGORY_LABELS: Record<string, string> = {
  "agent.lifecycle": "Agent Lifecycle",
  "agent.config": "Agent Config",
  "agent.deployment": "Deployment",
  "agent.channel": "Channels",
  "agent.workspace": "Workspace",
  "agent.skill": "Skills",
  "agent.workflow": "Workflows",
  "session.management": "Sessions",
  "message.autonomous": "Messages",
  "tool.execution": "Tool Execution",
  "billing.action": "Billing",
  "security.access": "Security Access",
  "security.change": "Security Change",
  "data.modification": "Data",
  "integration.action": "Integrations",
  "compliance.policy": "Compliance",
  "user.management": "Users",
  "org.management": "Organization",
};

export function AuditTrail() {
  const t = useTranslations("audit");
  const { getToken } = useAuth();

  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actorType, setActorType] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [integrityResult, setIntegrityResult] = useState<any>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [report, setReport] = useState<any>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const [activeTab, setActiveTab] = useState<"trail" | "stats" | "report">("trail");

  const fetchEntries = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getAuditTrail(token, {
        search: search || undefined,
        category: category || undefined,
        riskLevel: riskLevel || undefined,
        outcome: outcome || undefined,
        actorType: actorType || undefined,
        limit, offset,
      });
      setEntries(data.entries || []);
      setTotal(data.total || 0);
      setError(null);
    } catch (err) {
      if (entries.length === 0) setError("Failed to load audit trail");
    } finally {
      setIsLoading(false);
    }
  }, [getToken, search, category, riskLevel, outcome, actorType, offset]);

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getAuditStats(token);
      setStats(data);
    } catch (err) {
    }
  }, [getToken]);

  useEffect(() => { fetchEntries(); fetchStats(); }, [fetchEntries, fetchStats]);

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const token = await getToken();
      if (!token) return;
      const result = await apiClient.verifyAuditIntegrity(token);
      setIntegrityResult(result);
    } catch (err) {
    } finally { setIsVerifying(false); }
  };

  const handleExport = async (format: "csv" | "json") => {
    try {
      const token = await getToken();
      if (!token) return;
      const blob = await apiClient.exportAuditTrail(token, { format, category: category || undefined, includeMetadata: format === "json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-trail.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const handleGenerateReport = async () => {
    if (!reportFrom || !reportTo) return;
    setIsGeneratingReport(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getAuditComplianceReport(token, reportFrom, reportTo);
      setReport(data);
      setActiveTab("report");
      setShowReportModal(false);
    } catch {} finally { setIsGeneratingReport(false); }
  };

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const getActorLabel = (actor: any) => {
    if (!actor) return "Unknown";
    switch (actor.type) {
      case "user": return actor.email || actor.name || `User ${actor.userId?.slice(0, 8)}`;
      case "agent": return actor.agentName || `Agent ${actor.agentId?.slice(0, 8)}`;
      case "system": return `System (${actor.component})`;
      case "cron": return actor.jobName || `Cron ${actor.jobId}`;
      case "webhook": return actor.source || `Webhook`;
      case "api_key": return actor.keyName || `API Key`;
      default: return "Unknown";
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("total")}</div>
            <div className="text-2xl font-medium">{stats.totalEntries.toLocaleString()}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("last24h")}</div>
            <div className="text-2xl font-medium">{stats.last24h.toLocaleString()}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("last7d")}</div>
            <div className="text-2xl font-medium">{stats.last7d.toLocaleString()}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("chainIntegrity")}</div>
            <div className="text-sm">
              {integrityResult ? (
                <span className={integrityResult.status === "valid" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {integrityResult.status === "valid" ? t("chainValid") : t("chainBroken")}
                </span>
              ) : (
                <button onClick={handleVerify} disabled={isVerifying} className="text-xs underline hover:no-underline">
                  {isVerifying ? t("verifying") : t("verify")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tabs */}
      <div className="flex gap-0.5 border-b border-border">
        {(["trail", "stats", "report"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs transition-all border-b-2 ${
              activeTab === tab
                ? "border-black dark:border-foreground text-foreground font-medium"
                : "border-transparent text-gray-500 hover:text-foreground"
            }`}
          >
            {tab === "trail" ? "Audit Trail" : tab === "stats" ? t("stats") : t("report")}
          </button>
        ))}
      </div>

      {/* Tab: Trail */}
      {activeTab === "trail" && (
        <>
          <div className="flex flex-wrap gap-3">
            <input type="text" placeholder={t("search")} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} className="input flex-1 min-w-[200px]" />
            <select value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }} className="input w-auto">
              <option value="">{t("allCategories")}</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setOffset(0); }} className="input w-auto">
              <option value="">{t("allRiskLevels")}</option>
              <option value="low">{t("low")}</option>
              <option value="medium">{t("medium")}</option>
              <option value="high">{t("high")}</option>
              <option value="critical">{t("critical")}</option>
            </select>
            <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setOffset(0); }} className="input w-auto">
              <option value="">{t("allOutcomes")}</option>
              <option value="success">{t("success")}</option>
              <option value="failure">{t("failure")}</option>
              <option value="denied">{t("denied")}</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => handleExport("csv")} className="btn-secondary">{t("exportCsv")}</button>
              <button onClick={() => handleExport("json")} className="btn-secondary">{t("exportJson")}</button>
              <button onClick={() => setShowReportModal(true)} className="btn-primary-sm">{t("report")}</button>
            </div>
          </div>

          {error && (<div className="card border-red-300 dark:border-red-700"><p className="text-red-500 dark:text-red-400 text-sm">{error}</p></div>)}

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="h-4 bg-border rounded w-1/3 mb-2" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-4 opacity-20">&#9881;</div>
              <h3 className="text-sm font-medium mb-1">{t("noEntries")}</h3>
              <p className="text-xs text-muted-foreground">{t("noEntriesDescription")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <motion.div key={entry._id} layout className="card p-0 overflow-hidden cursor-pointer hover:border-foreground transition-colors" onClick={() => setExpandedEntry(expandedEntry === entry._id ? null : entry._id)}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${entry.riskLevel === "critical" ? "bg-red-500" : entry.riskLevel === "high" ? "bg-orange-500" : entry.riskLevel === "medium" ? "bg-amber-500" : "bg-gray-400"}`} />
                    <span className="text-xs text-muted-foreground font-mono shrink-0 w-[130px]">{formatTimestamp(entry.timestamp)}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${RISK_COLORS[entry.riskLevel] || RISK_COLORS.low}`}>{entry.action}</span>
                    <span className="text-xs truncate flex-1 font-medium">{entry.title}</span>
                    {entry.agentName && (<span className="text-xs text-muted-foreground shrink-0">{entry.agentName}</span>)}
                    <span className={`text-xs shrink-0 ${OUTCOME_COLORS[entry.outcome] || ""}`}>{entry.outcome}</span>
                    <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${expandedEntry === entry._id ? "rotate-180" : ""}`} strokeWidth={2} />
                  </div>

                  <AnimatePresence>
                    {expandedEntry === entry._id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border/60">
                        <div className="px-4 py-4 space-y-4 text-xs">
                          <div>
                            <div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">Description</div>
                            <div>{entry.description}</div>
                          </div>
                          {entry.reasoning && (<div><div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">{t("reasoning")}</div><div className="bg-secondary p-3 border border-border rounded-lg">{entry.reasoning}</div></div>)}
                          {entry.changes && entry.changes.length > 0 && (<div><div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">{t("changes")}</div><div className="space-y-1">{entry.changes.map((change: any, i: number) => (<div key={i} className="flex gap-2 items-start font-mono text-xs"><span className="text-gray-500 shrink-0">{change.field}:</span><span className="text-red-500 line-through">{JSON.stringify(change.before)}</span><span className="text-gray-400">&rarr;</span><span className="text-green-600 dark:text-green-400">{JSON.stringify(change.after)}</span></div>))}</div></div>)}
                          <div className="grid grid-cols-2 gap-4">
                            <div><div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">{t("actor")}</div><div className="font-mono text-xs"><span className="text-gray-500">{entry.actor?.type}:</span> {getActorLabel(entry.actor)}</div></div>
                            {entry.resource && (<div><div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">{t("resource")}</div><div className="font-mono text-xs">{entry.resource.type}: {entry.resource.name || entry.resource.id}</div></div>)}
                          </div>
                          <div className="pt-2 border-t border-border/60"><div className="grid grid-cols-2 gap-4 font-mono text-xs text-gray-400"><div><span className="text-gray-500">{t("hash")}:</span> <span className="select-all">{entry.entryHash?.slice(0, 16)}...</span></div><div><span className="text-gray-500">{t("previousHash")}:</span> <span className="select-all">{entry.previousHash?.slice(0, 16) || "(genesis)"}...</span></div></div></div>
                          {entry.metadata && Object.keys(entry.metadata).length > 0 && (<div><div className="text-muted-foreground mb-1 font-medium uppercase tracking-wider text-xs">{t("metadata")}</div><pre className="bg-secondary p-2 border border-border rounded-lg text-xs font-mono overflow-x-auto">{JSON.stringify(entry.metadata, null, 2)}</pre></div>)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}

              {total > limit && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-gray-500">{offset + 1}–{Math.min(offset + limit, total)} {t("of")} {total} {t("entries")}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="btn-secondary px-2 py-1 disabled:opacity-30">&larr;</button>
                    <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total} className="btn-secondary px-2 py-1 disabled:opacity-30">&rarr;</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Tab: Stats */}
      {activeTab === "stats" && stats && (
        <div className="space-y-8">
          <div className="card p-6"><h3 className="text-sm font-medium mb-4">{t("riskDistribution")}</h3><div className="grid grid-cols-4 gap-4">{(["low", "medium", "high", "critical"] as const).map((level) => (<div key={level} className="text-center"><div className={`text-2xl font-medium ${level === "critical" ? "text-red-600" : level === "high" ? "text-orange-600" : level === "medium" ? "text-amber-600" : "text-gray-600"}`}>{(stats.riskDistribution?.[level] || 0).toLocaleString()}</div><div className="text-xs text-gray-500 uppercase tracking-wider mt-1">{t(level)}</div></div>))}</div></div>
          <div className="card p-6"><h3 className="text-sm font-medium mb-4">{t("actorDistribution")}</h3><div className="space-y-2">{Object.entries(stats.actorDistribution || {}).map(([type, count]) => (<div key={type} className="flex items-center justify-between"><span className="text-xs">{type}</span><div className="flex items-center gap-2"><div className="h-1.5 bg-foreground rounded" style={{ width: `${Math.max(20, ((count as number) / stats.totalEntries) * 200)}px` }} /><span className="text-xs font-mono text-gray-500 w-12 text-right">{(count as number).toLocaleString()}</span></div></div>))}</div></div>
          <div className="card p-6"><h3 className="text-sm font-medium mb-4">{t("topActions")}</h3><div className="space-y-2">{(stats.topActions || []).map((item: any) => (<div key={item.action} className="flex items-center justify-between"><span className="text-xs font-mono">{item.action}</span><span className="text-xs text-gray-500">{item.count}</span></div>))}</div></div>
        </div>
      )}

      {/* Tab: Report */}
      {activeTab === "report" && report && (
        <div className="space-y-8">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-medium">{t("report")}</h3><span className="text-xs text-gray-500 font-mono">{report.period?.from?.slice(0, 10)} &mdash; {report.period?.to?.slice(0, 10)}</span></div>
            <div className="grid grid-cols-3 gap-6">
              <div><div className="text-2xl font-medium">{report.summary?.totalEntries?.toLocaleString()}</div><div className="text-xs text-gray-500 uppercase tracking-wider">{t("total")}</div></div>
              <div><div className={`text-2xl font-medium ${report.chainIntegrity?.status === "valid" ? "text-green-600" : "text-red-600"}`}>{report.chainIntegrity?.status === "valid" ? "VALID" : "BROKEN"}</div><div className="text-xs text-gray-500 uppercase tracking-wider">{t("chainIntegrity")}</div></div>
              <div><div className="text-2xl font-medium text-red-600">{(report.highRiskActions?.length || 0) + (report.failedActions?.length || 0)}</div><div className="text-xs text-gray-500 uppercase tracking-wider">Issues</div></div>
            </div>
          </div>
          <div className="card p-6"><h3 className="text-sm font-medium mb-4">Actions by Category</h3><div className="space-y-2">{Object.entries(report.summary?.byCategory || {}).map(([cat, count]) => (<div key={cat} className="flex items-center justify-between"><span className="text-xs">{CATEGORY_LABELS[cat] || cat}</span><span className="text-xs font-mono text-gray-500">{(count as number).toLocaleString()}</span></div>))}</div></div>
          {report.agents?.length > 0 && (<div className="card p-6"><h3 className="text-sm font-medium mb-4">Agent Risk Profiles</h3><div className="space-y-3">{report.agents.map((agent: any) => (<div key={agent.agentId} className="flex items-center justify-between"><div><span className="text-xs font-medium">{agent.agentName}</span><span className="text-xs text-gray-500 ml-2">{agent.actionCount} actions</span></div><div className="flex gap-1">{(["low", "medium", "high", "critical"] as const).map((level) => (agent.riskProfile?.[level] > 0 && (<span key={level} className={`text-xs px-1.5 py-0.5 rounded ${RISK_COLORS[level]}`}>{agent.riskProfile[level]} {level}</span>)))}</div></div>))}</div></div>)}
          {report.highRiskActions?.length > 0 && (<div className="card p-6"><h3 className="text-sm font-medium mb-4 text-red-600">High Risk Actions ({report.highRiskActions.length})</h3><div className="space-y-2">{report.highRiskActions.slice(0, 20).map((entry: any) => (<div key={entry._id} className="flex items-center gap-3 text-xs"><span className="text-xs text-gray-400 font-mono w-[130px] shrink-0">{formatTimestamp(entry.timestamp)}</span><span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${RISK_COLORS[entry.riskLevel]}`}>{entry.riskLevel}</span><span className="truncate">{entry.title}</span></div>))}</div></div>)}
        </div>
      )}

      {activeTab === "report" && !report && (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-4 opacity-20">&#128203;</div>
          <h3 className="text-sm font-medium mb-2">{t("report")}</h3>
          <p className="text-xs text-gray-500 mb-4">Select a date range to generate a compliance report.</p>
          <button onClick={() => setShowReportModal(true)} className="btn-primary-sm px-4">{t("generateReport")}</button>
        </div>
      )}

      {/* Report Modal */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReportModal(false)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-card border border-border rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-medium mb-4">{t("generateReport")}</h3>
              <div className="space-y-3 mb-6">
                <div><label className="text-xs text-gray-500 mb-1 block">{t("from")}</label><input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="input w-full" /></div>
                <div><label className="text-xs text-gray-500 mb-1 block">{t("to")}</label><input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="input w-full" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowReportModal(false)} className="btn-secondary px-4">Cancel</button>
                <button onClick={handleGenerateReport} disabled={!reportFrom || !reportTo || isGeneratingReport} className="btn-primary-sm px-4 disabled:opacity-50">{isGeneratingReport ? "..." : t("generateReport")}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
