"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { fetchEventSource } from "@microsoft/fetch-event-source";

// Gateway event types forwarded from backend SSE
export interface GatewayEvent {
  type: "gateway_event" | "agent_connected" | "agent_disconnected" | "connected";
  agentId?: string;
  event?: string;
  payload?: any;
  timestamp?: number;
  agentIds?: string[];
}

// Callback for filtering events by agent or type
export type EventFilter = (event: GatewayEvent) => boolean;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

/**
 * React hook for real-time gateway event streaming via SSE.
 * Uses fetchEventSource with Authorization header (no token in URL for better security).
 *
 * Usage:
 * ```ts
 * const { lastEvent, isConnected } = useEventStream({
 *   filter: (e) => e.agentId === myAgentId,
 *   onEvent: (e) => console.log('Got event:', e),
 * });
 * ```
 */
export function useEventStream(options?: {
  /** Only fire onEvent for events matching this filter */
  filter?: EventFilter;
  /** Callback for each incoming event (after filtering) */
  onEvent?: (event: GatewayEvent) => void;
  /** Disable the stream (useful for conditional activation) */
  enabled?: boolean;
}) {
  const { getToken } = useAuth();
  const { filter, onEvent, enabled = true } = options || {};

  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<GatewayEvent | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const filterRef = useRef(filter);
  const onEventRef = useRef(onEvent);

  // Keep refs current
  filterRef.current = filter;
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    // Abort existing connection
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (!enabled) return;

    try {
      const token = await getToken();
      if (!token) return;

      const controller = new AbortController();
      abortRef.current = controller;

      await fetchEventSource(`${API_BASE}/events/stream`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        openWhenHidden: true, // Keep connection when tab is in background
        async onopen(res) {
          if (res.ok) {
            setIsConnected(true);
            return;
          }
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new Error(`SSE auth failed: ${res.status}`);
          }
          throw new Error(`SSE failed: ${res.status}`);
        },
        onmessage: (event) => {
          try {
            const data = event.data?.trim();
            if (!data || data.startsWith(":")) return; // heartbeat comment

            const parsed: GatewayEvent = JSON.parse(data);

            if (filterRef.current && !filterRef.current(parsed)) return;

            setLastEvent(parsed);
            onEventRef.current?.(parsed);
          } catch {
            // Ignore malformed events (e.g. heartbeat comments)
          }
        },
        onerror: (err) => {
          setIsConnected(false);
          if (err?.name === "AbortError") throw err; // Don't retry on intentional abort
          // Throw to trigger retry for transient errors
          throw err;
        },
        onclose: () => {
          setIsConnected(false);
        },
      });
    } catch {
      setIsConnected(false);
      // fetchEventSource stops on uncaught errors; we intentionally don't reconnect
      // here — useEffect will recall connect on next dependency change
    }
  }, [getToken, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  return { lastEvent, isConnected };
}
