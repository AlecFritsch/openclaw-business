"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import type { ApprovalRequest } from "@openclaw-business/shared";

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-gray-400",
};

interface ApprovalsTabProps {
  agentId: string;
  onCountChange?: (count: number) => void;
}

export function ApprovalsTab({ agentId, onCountChange }: ApprovalsTabProps) {
  const { getToken } = useAuth();
  const t = useTranslations("approvals");
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.listApprovals(token, {
        agentId,
        status: "pending",
        limit: 50,
      });
      setApprovals(data.approvals as any);
      onCountChange?.(data.approvals.length);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken, onCountChange]);

  useEffect(() => { load(); }, [load]);

  // Poll every 15s
  useEffect(() => {
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const handleResolve = async (id: string, status: "approved" | "rejected") => {
    try {
      setResolvingId(id);
      const token = await getToken();
      if (!token) return;
      await apiClient.resolveApproval(token, id, { status });
      await load();
    } catch {
      // silent
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-gray-400">{t("loading")}</div>;
  }

  if (approvals.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="p-3 space-y-2">
        {approvals.map((a) => (
          <div
            key={a._id}
            className="border border-border rounded-lg p-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${PRIORITY_DOT[a.priority]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{a.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                  {a.description}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>{t(`actionType.${a.actionType}` as any)}</span>
                  {a.confidence !== undefined && (
                    <span>{Math.round(a.confidence * 100)}%</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleResolve(a._id!, "approved")}
                disabled={resolvingId === a._id}
                className="flex-1 text-xs py-1 rounded bg-foreground text-primary-foreground hover:opacity-80 disabled:opacity-50 font-medium"
              >
                {resolvingId === a._id ? "..." : t("approve")}
              </button>
              <button
                onClick={() => handleResolve(a._id!, "rejected")}
                disabled={resolvingId === a._id}
                className="flex-1 text-xs py-1 rounded-lg border border-border text-gray-500 hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400 disabled:opacity-50"
              >
                {t("reject")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
