"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import type { Mission as EngineMission, MissionRun } from "@openclaw-business/shared";

interface UseMissionEngineReturn {
  missions: EngineMission[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Detail
  selectedMission: EngineMission | null;
  selectedRuns: MissionRun[];
  runsLoading: boolean;
  selectMission: (id: string) => Promise<void>;
  clearSelection: () => void;
  // Actions
  runMission: (id: string) => Promise<void>;
  pauseMission: (id: string) => Promise<void>;
  resumeMission: (id: string) => Promise<void>;
  deleteMission: (id: string) => Promise<void>;
}

export function useMissionEngine(agentId: string): UseMissionEngineReturn {
  const { getToken } = useAuth();
  const [missions, setMissions] = useState<EngineMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<EngineMission | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<MissionRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const reload = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token || !agentId) return;
      const data = await apiClient.listMissions(token, agentId);
      setMissions((data as any).missions || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load missions");
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => {
    if (agentId) { setLoading(true); reload(); }
  }, [agentId, reload]);

  // Listen for panel open events to refresh
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("open-missions-panel", handler);
    return () => window.removeEventListener("open-missions-panel", handler);
  }, [reload]);

  // SSE: live mission lifecycle events
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    let controller: AbortController | null = null;

    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      controller = new AbortController();
      try {
        const res = await fetch(`/api/agents/${agentId}/missions/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              // Mission event received — reload list
              reload();
              break;
            }
          }
        }
      } catch {
        // SSE disconnected — silent
      }
    })();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [agentId, getToken, reload]);

  const selectMission = useCallback(async (id: string) => {
    setRunsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getMission(token, agentId, id);
      setSelectedMission((data as any).mission);
      setSelectedRuns((data as any).runs || []);
    } catch {} finally { setRunsLoading(false); }
  }, [agentId, getToken]);

  const clearSelection = useCallback(() => {
    setSelectedMission(null);
    setSelectedRuns([]);
  }, []);

  const runMission = useCallback(async (id: string) => {
    const token = await getToken();
    if (!token) return;
    await apiClient.runMission(token, agentId, id);
    reload();
  }, [agentId, getToken, reload]);

  const pauseMission = useCallback(async (id: string) => {
    const token = await getToken();
    if (!token) return;
    await apiClient.updateMission(token, agentId, id, { status: "paused" });
    reload();
  }, [agentId, getToken, reload]);

  const resumeMission = useCallback(async (id: string) => {
    const token = await getToken();
    if (!token) return;
    await apiClient.updateMission(token, agentId, id, { status: "idle" });
    reload();
  }, [agentId, getToken, reload]);

  const deleteMission = useCallback(async (id: string) => {
    const token = await getToken();
    if (!token) return;
    await apiClient.deleteMission(token, agentId, id);
    setMissions((prev) => prev.filter((m) => m._id !== id));
    if (selectedMission?._id === id) clearSelection();
  }, [agentId, getToken, selectedMission, clearSelection]);

  return {
    missions, loading, error, reload,
    selectedMission, selectedRuns, runsLoading, selectMission, clearSelection,
    runMission, pauseMission, resumeMission, deleteMission,
  };
}
