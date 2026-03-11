"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "./api-client";

const POLL_INTERVAL_MS = 30_000;

/**
 * Returns the total count of pending pairing requests for an agent.
 * Polls every 30s when agentId is set. Returns null when not loaded.
 */
export function usePairingCount(agentId: string | undefined): number | null {
  const { getToken, isSignedIn } = useAuth();
  const [count, setCount] = useState<number | null>(null);

  const fetchCount = useCallback(async () => {
    if (!isSignedIn || !agentId) {
      setCount(null);
      return;
    }
    try {
      const token = await getToken();
      if (!token) return;
      const res = await apiClient.getPairingSummary(token, agentId);
      setCount(res.totalPending);
    } catch {
      setCount(null);
    }
  }, [getToken, isSignedIn, agentId]);

  useEffect(() => {
    fetchCount();
    if (!isSignedIn || !agentId) return;
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCount, isSignedIn, agentId]);

  return count;
}
