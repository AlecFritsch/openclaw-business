"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { showToast } from "@/components/toast";
import { AppShell } from "@/components/app-shell";
import { apiClient } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { PLAN_PRICES, type BillingUsage } from "@openclaw-business/shared";

export default function BillingPage() {
  const { getToken } = useAuth();
  const { can } = usePermissions();
  const searchParams = useSearchParams();
  const t = useTranslations("billing");
  const toast = useTranslations("toasts");
  const [loading, setLoading] = useState(true);
  const [usageData, setUsageData] = useState<BillingUsage | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);

  useEffect(() => { loadBillingData(); }, []);

  useEffect(() => {
    if (searchParams.get("basis_purchased")) {
      showToast(t("basisPurchased"), "success");
      window.history.replaceState({}, "", "/billing");
      loadBillingData();
    }
  }, [searchParams]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBillingData = async () => {
    setLoadError(null);
    try {
      const token = await getToken();
      if (!token) { setLoading(false); return; }
      const [usageRes, invoicesRes] = await Promise.all([
        apiClient.getUsage(token).catch((e) => { setLoadError(e?.message || "usage"); return { usage: null }; }),
        apiClient.getInvoices(token).catch(() => ({ invoices: [] })),
      ]);
      setUsageData(usageRes?.usage ?? null);
      setInvoices(invoicesRes?.invoices || []);
    } catch (e) {
      setLoadError((e as Error)?.message || "unknown");
      showToast(toast("billingLoadFailed"), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!can('billing.manage')) { showToast(t("adminOnly"), "error"); return; }
    try {
      const token = await getToken();
      if (!token) return;
      const { url } = await apiClient.createPortal(token);
      window.location.href = url;
    } catch {
      showToast(toast("billingLoadFailed"), "error");
    }
  };

  const pct = (used: number, limit: number) => limit <= 0 ? 0 : Math.min((used / limit) * 100, 100);
  const barColor = (p: number) => p >= 90 ? "bg-red-500" : p >= 70 ? "bg-yellow-500" : "bg-foreground";

  if (loading) {
    return (
      <AppShell embedded>
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-gray-300 dark:border-border border-t-foreground rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (loadError && !usageData) {
    return (
      <AppShell embedded>
        <div className="max-w-4xl mx-auto py-20 text-center">
          <p className="text-muted-foreground mb-4">{toast("billingLoadFailed")}</p>
          <button onClick={loadBillingData} className="btn-primary-sm px-4">
            {t("retry")}
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-medium mb-1">{t("title")}</h1>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>

        {/* Plan Card */}
        <div className="card mb-8">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">{t("currentPlan")}</span>
              <h3 className="text-xl font-medium mt-1">
                {usageData?.plan === "professional" ? "Professional" : usageData?.plan === "enterprise" ? "Enterprise" : t("unpaidPlan")}
              </h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-mono font-medium">{PLAN_PRICES[usageData?.plan || "unpaid"]}</span>
                {(usageData?.plan || "unpaid") !== "unpaid" && (
                  <span className="text-xs text-muted-foreground">/ Monat</span>
                )}
              </div>
            </div>
            {(usageData?.plan === "professional" || usageData?.plan === "enterprise") && (
              <button onClick={handleManageSubscription} className="btn-ghost-sm px-4">
                {t("manageSubscription")}
              </button>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {usageData?.limits && (
              <>
                <span>{(usageData.plan === "professional" || usageData.plan === "enterprise") && usageData.limits.agents === 0 ? "∞" : usageData.limits.agents} Agents</span>
                <span>{usageData.limits.messagesPerAgent === 0 ? "∞" : usageData.limits.messagesPerAgent.toLocaleString()} Messages</span>
                <span>{usageData.limits.storage} GB Storage</span>
              </>
            )}
          </div>
        </div>

        {/* Professional €250/user — Upgrade für Unpaid */}
        {usageData?.plan === "unpaid" && can("billing.manage") && (
          <div className="card mb-8 border-2 border-dashed border-foreground/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium">Professional</h3>
                <p className="text-xs text-muted-foreground mt-0.5">€250/user/month — 3 Agents, 5.000 Messages/agent</p>
              </div>
              <a href="/waiting" className="btn-primary-sm px-4 inline-block text-center">
                {t("upgradeToPro")}
              </a>
            </div>
          </div>
        )}

        {/* Usage */}
        {usageData && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">{t("currentUsage")}</h2>
              <span className="text-xs text-muted-foreground font-mono">{usageData.currentPeriod}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: t("agentsUsage"), used: usageData.agents.used, limit: usageData.agents.limit },
                { label: t("messagesUsage"), used: usageData.messages.used, limit: usageData.messages.limit },
                { label: t("storageUsage"), used: usageData.storage.used, limit: usageData.storage.limit, suffix: usageData.storage.unit },
              ].map(({ label, used, limit, suffix }) => {
                const p = pct(used, limit);
                return (
                  <div key={label} className="rounded-xl border border-border p-4">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
                      <span className="text-sm font-mono font-medium">
                        {typeof used === 'number' && used > 999 ? used.toLocaleString() : used}
                        <span className="text-muted-foreground">/{limit === -1 ? "∞" : (typeof limit === 'number' && limit > 999 ? limit.toLocaleString() : limit)}{suffix ? ` ${suffix}` : ''}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted">
                      <div className={`h-full ${barColor(p)} transition-all duration-500`} style={{ width: `${p}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Invoices */}
        {invoices.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground mb-4">{t("invoiceHistory")}</h2>
            <div className="rounded-xl border border-border divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden">
              {invoices.map((inv, i) => (
                <div key={inv._id || inv.id || i} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-background transition-colors">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono">{inv.invoiceNumber || inv.id}</span>
                    <span className="text-xs text-muted-foreground">{inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : inv.date}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs uppercase tracking-wider font-mono ${inv.status === "paid" ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                      {inv.status}
                    </span>
                  </div>
                  <span className="text-sm font-mono font-medium">{typeof inv.amount === "number" ? `€${inv.amount.toFixed(2)}` : inv.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
