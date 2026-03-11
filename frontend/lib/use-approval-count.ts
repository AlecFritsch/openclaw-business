"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "./api-client";

const POLL_INTERVAL_MS = 60_000;

/**
 * Returns the count of pending approval requests.
 * Polls every 60s when signed in. Returns null when not loaded or not signed in.
 */
export function useApprovalCount(): number | null {
  const { getToken, isSignedIn } = useAuth();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const fetchCount = useCallback(async () => {
    if (!isSignedIn) {
      setPendingCount(null);
      return;
    }
    try {
      const token = await getToken();
      if (!token) return;
      const counts = await apiClient.getApprovalCounts(token);
      setPendingCount(counts.pending);
    } catch {
      setPendingCount(null);
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    fetchCount();
    if (!isSignedIn) return;
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCount, isSignedIn]);

  return pendingCount;
}
