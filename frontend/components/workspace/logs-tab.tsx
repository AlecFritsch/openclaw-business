"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { useTranslations } from "next-intl";

interface LogsTabProps {
  agentId: string;
  logs: string;
  onLogsChange: (logs: string) => void;
}

export function LogsTab({ agentId, logs, onLogsChange }: LogsTabProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { getToken } = useAuth();
  const t = useTranslations("workspace.logsTab");

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getGatewayLogs(token, agentId, 200);
      onLogsChange(data.logs || "");
    } catch {
      // silent
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted shrink-0 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t("gatewayLogs")}</span>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-xs px-2 py-1 border border-border hover:border-foreground rounded-lg transition-colors disabled:opacity-50"
        >
          {isRefreshing ? "..." : t("refresh")}
        </button>
      </div>

      {/* Logs Content */}
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-gray-700 dark:text-muted-foreground">
          {logs || t("noLogs")}
        </pre>
      </div>
    </div>
  );
}
