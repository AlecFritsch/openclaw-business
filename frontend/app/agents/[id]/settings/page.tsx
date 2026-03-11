"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Navbar } from "@/components/navbar";
import { AgentConfigurationContent } from "./configure";

type Tab = "configure" | "logs";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const [agentId, setAgentId] = useState("");
  const [tab, setTab] = useState<Tab>("configure");

  useEffect(() => { params.then(p => setAgentId(p.id)); }, [params]);

  if (!agentId) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background p-1 md:p-2">
      <div className="flex-1 flex flex-col min-h-0 box-modal overflow-hidden">
        <Navbar embedded />
        <div className="border-b border-border/40 px-4 sm:px-5">
          <div className="flex gap-4">
            {(["configure", "logs"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t === "configure" ? "Configure" : "Logs"}
              </button>
            ))}
          </div>
        </div>
        <main className="flex-1 overflow-auto w-full px-4 sm:px-5 py-4 sm:py-5">
          {tab === "configure" ? (
            <AgentConfigurationContent agentId={agentId} />
          ) : (
            <LogsContent agentId={agentId} />
          )}
        </main>
      </div>
    </div>
  );
}

function LogsContent({ agentId }: { agentId: string }) {
  const { getToken } = useAuth();
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/agents/${agentId}/gateway/logs?limit=500`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setLogs(data.logs || "");
    } catch {} finally { setLoading(false); }
  }, [agentId, getToken]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }, [logs]);

  const filtered = filter ? logs.split("\n").filter(l => l.toLowerCase().includes(filter.toLowerCase())).join("\n") : logs;

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-semibold">Logs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Agent gateway logs</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..."
            className="px-2.5 py-1 rounded-md border border-border/60 bg-background text-xs w-40" />
          <button onClick={load} className="px-2.5 py-1 rounded-md border border-border/60 text-xs hover:bg-muted/60 transition-colors">Refresh</button>
        </div>
      </div>
      <pre ref={preRef}
        className="flex-1 min-h-0 overflow-auto rounded-lg bg-gray-950 dark:bg-black p-4 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap break-all"
        style={{ minHeight: "400px" }}>
        {loading ? "Loading..." : filtered || "No logs available"}
      </pre>
    </div>
  );
}
