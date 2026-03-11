"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";
import { ChatMessage, renderContent } from "@/components/workspace/chat-panel";
import { useEventStream } from "@/lib/use-event-stream";

// ── Helpers ──────────────────────────────────────────────────

/** Detect internal system prompts that should never be shown to users */
function isInternalPrompt(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("Read HEARTBEAT.md") || t.includes("reply HEARTBEAT_OK")) return true;
  if (t.startsWith("[Cron job") || t.startsWith("[Scheduled task")) return true;
  if (t.startsWith("[cron:")) return true;
  if (t.startsWith("Read BOOTSTRAP.md")) return true;
  if (t.startsWith("Session nearing compaction")) return true;
  return false;
}

/** Filter out system noise from messages */
export function filterSystemMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((msg) => {
    const text = renderContent(msg.content).trim();
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const blocks = msg.content as Array<{ type?: string; text?: string }>;
        if (blocks.length > 0 && blocks.every((b) => b?.type === "tool_result")) return false;
      }
      if (isInternalPrompt(text)) return false;
      return true;
    }
    if (!text) return false;
    if (text.includes("conversation_label")) return false;
    if (text === "HEARTBEAT_OK" || text.startsWith("HEARTBEAT_OK") || text.includes("HEARTBEAT_OK")) return false;
    return true;
  });
}

/** Canonical fallback session key */
const DEFAULT_SESSION_KEY = "agent:main:main";

export type ChatStatus = "idle" | "sending" | "waiting" | "error";

interface SessionInfo {
  key: string;
  agentId: string;
  channel?: string;
  peer?: string;
  messageCount: number;
  lastActivityAt?: string;
  updatedAt?: number | null;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  kind?: string;
}

/** Filter out system/cron sessions */
function filterSessions(sessions: SessionInfo[]): SessionInfo[] {
  return sessions
    .filter((s) => !s.key.startsWith("cron:") && !s.key.startsWith("hook:"))
    .map((s) => ({
      ...s,
      messageCount: s.messageCount ?? 0,
      lastActivityAt: s.lastActivityAt ?? (typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined),
    }));
}

interface UseHavocChatOptions {
  agentId: string;
  knowledgeEnabled?: boolean;
  enabledSources?: Set<string>;
  onMemoryReload?: () => void;
  onWorkflowSync?: () => void;
}

export function useHavocChat({
  agentId,
  knowledgeEnabled = true,
  enabledSources = new Set(["platform", "google_drive", "notion"]),
  onMemoryReload,
  onWorkflowSync,
}: UseHavocChatOptions) {
  const { getToken } = useAuth();

  // ── Session State ──
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  // ── Chat State ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [isAborting, setIsAborting] = useState(false);

  // ── Refs ──
  const isSendingRef = useRef(false);
  const selectedSessionRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const msgCountAtSendRef = useRef(0);
  const pendingUserMsgRef = useRef<string | null>(null);

  // ── Ref sync ──
  useEffect(() => { selectedSessionRef.current = selectedSession; }, [selectedSession]);

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, []);

  // ── Finalize streaming ──
  const finalizeStreaming = useCallback(async () => {
    if (!isSendingRef.current) return;
    isSendingRef.current = false;

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    setStreamingText("");

    // Load final messages BEFORE hiding thinking indicator
    await new Promise((r) => setTimeout(r, 400));

    try {
      const token = await getToken();
      const session = selectedSessionRef.current;
      if (token && session) {
        const data = await apiClient.getSessionHistory(token, agentId, session, 500);
        const filtered = filterSystemMessages(data.messages || []);
        pendingUserMsgRef.current = null;
        setMessages(filtered);
      }
    } catch {}

    // NOW hide thinking — messages are already loaded
    setStatus("idle");

    onMemoryReload?.();
    onWorkflowSync?.();
  }, [agentId, getToken, onMemoryReload, onWorkflowSync]);

  // ── Init session + first load ──
  useEffect(() => {
    if (!agentId) return;

    const init = async () => {
      try {
        const token = await getToken();
        if (!token) { setIsConnecting(false); return; }

        const sessionsData = await apiClient.getGatewaySessions(token, agentId).catch(() => ({ sessions: [] }));
        const filtered = filterSessions(sessionsData.sessions || []);
        setSessions(filtered);

        const webchat = filtered.find(
          (s: any) => s.channel === "webchat" || s.key?.includes("webchat") || s.key?.includes("operator")
        );
        const target = webchat || filtered[0];

        if (target) {
          setSelectedSession(target.key);
          const data = await apiClient.getSessionHistory(token, agentId, target.key, 500);
          setMessages(filterSystemMessages(data.messages || []));
        } else {
          setSelectedSession(DEFAULT_SESSION_KEY);
          try {
            const data = await apiClient.getSessionHistory(token, agentId, DEFAULT_SESSION_KEY, 500);
            setMessages(filterSystemMessages(data.messages || []));
          } catch {}
        }
      } catch {
        setSelectedSession(DEFAULT_SESSION_KEY);
      } finally {
        setIsConnecting(false);
      }
    };

    init();
  }, [agentId, getToken]);

  // ── SSE event handling ──
  useEventStream({
    filter: (e) => e.agentId === agentId,
    onEvent: (event) => {
      if (!isSendingRef.current) return;
      if (event.type !== "gateway_event") return;

      const ev = event.event || "";
      const payload = event.payload || {};
      const payloadSession = payload.sessionKey || payload.session_key || "";
      const current = selectedSessionRef.current || "";

      const sessionMatch =
        !payloadSession ||
        payloadSession === current ||
        payloadSession.endsWith(`:${current}`);
      const isCompletion = ["run.complete", "run.end", "message", "session_update", "agent", "chat"].includes(ev) || ev.includes("stream.end");
      const completionSessionMatch =
        isCompletion && payloadSession && current &&
        payloadSession.startsWith("agent:") && current.startsWith("agent:") &&
        payloadSession.split(":")[1] === current.split(":")[1];
      if (!sessionMatch && !completionSessionMatch) return;

      if (ev === "tick" || ev === "shutdown" || ev === "health" || ev === "heartbeat") return;

      if (ev === "agent") {
        const stream = payload.stream || "";
        const data = payload.data || {};
        if (stream === "assistant") return;
        if (stream === "lifecycle" && (data.phase === "end" || data.phase === "error")) {
          finalizeStreaming();
          return;
        }
        return;
      }

      if (ev === "chat" && (payload.state === "final" || payload.state === "complete")) {
        finalizeStreaming();
        return;
      }

      if (ev.includes("delta")) return;

      if (ev === "run.complete" || ev === "run.end" || ev.includes("stream.end")) {
        finalizeStreaming();
        return;
      }

      if (ev === "message" || ev === "session_update") {
        finalizeStreaming();
      }
    },
    enabled: !!agentId,
  });

  // ── Select session ──
  const selectSession = useCallback(async (key: string) => {
    setSelectedSession(key);
    selectedSessionRef.current = key;
    setMessages([]);
    setStreamingText("");
    isSendingRef.current = false;
    setStatus("idle");

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getSessionHistory(token, agentId, key, 500);
      if (selectedSessionRef.current !== key) return;
      setMessages(filterSystemMessages(data.messages || []));
    } catch {
      if (selectedSessionRef.current !== key) return;
      setMessages([]);
    }
  }, [agentId, getToken]);

  // ── Send message ──
  const send = useCallback(async (text: string) => {
    const userMsg = text.trim();
    if (!userMsg || !selectedSession || isSendingRef.current) return;

    setStatus("sending");
    isSendingRef.current = true;
    setStreamingText("");
    pendingUserMsgRef.current = userMsg;
    msgCountAtSendRef.current = messages.length;
    setMessages((prev) => [...prev, { role: "user", content: userMsg, timestamp: new Date().toISOString() }]);

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    try {
      const token = await getToken();
      if (!token) throw new Error("No auth token");

      // RAG: prepend knowledge context if enabled
      let msgToSend = userMsg;
      if (knowledgeEnabled && enabledSources.size > 0) {
        try {
          const sourceTypes = Array.from(enabledSources);
          const res = await fetch(`/api/knowledge/search`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userMsg, agentId, limit: 3, sourceTypes }),
          });
          const data = await res.json();
          if (data.results?.length) {
            const ctx = data.results.map((r: any, i: number) =>
              `[Source ${i + 1}: ${r.sourceName || r.sourceType || 'unknown'}]\n${r.text}`
            ).join('\n---\n');
            msgToSend = `<knowledge_context>\n${ctx}\n</knowledge_context>\n\n${userMsg}`;
          }
        } catch {}
      }

      setStatus("waiting");
      await apiClient.sendGatewayMessage(token, agentId, selectedSession, msgToSend);

      // Refresh sessions — gateway may create a new key
      try {
        const sessionsData = await apiClient.getGatewaySessions(token, agentId);
        const filtered = filterSessions(sessionsData.sessions || []);
        setSessions(filtered);
        const current = selectedSessionRef.current || "";
        const defaultKeys = ["main", DEFAULT_SESSION_KEY];
        const matched = filtered.find(
          (s: any) =>
            s.key === current ||
            s.key?.endsWith(`:${current}`) ||
            (defaultKeys.includes(current) && (s.key?.includes("webchat") || s.key?.includes("operator") || s.key?.endsWith(":main")))
        );
        if (matched && matched.key !== current) {
          setSelectedSession(matched.key);
          selectedSessionRef.current = matched.key;
        }
      } catch {}

      // Fallback poll
      let elapsed = 0;
      const INITIAL_DELAY = 800;
      const POLL_INTERVAL = 1500;
      const MAX_TIMEOUT = 120000;

      const pollForResponse = async () => {
        if (!isSendingRef.current) return;
        try {
          const t = await getToken();
          const session = selectedSessionRef.current;
          if (t && session) {
            const data = await apiClient.getSessionHistory(t, agentId, session, 500);
            const filtered = filterSystemMessages(data.messages || []);
            if (filtered.length > msgCountAtSendRef.current) {
              const lastMsg = filtered[filtered.length - 1];
              if (lastMsg?.role === "assistant") {
                isSendingRef.current = false;
                setStatus("idle");
                setStreamingText("");
                pendingUserMsgRef.current = null;
                setMessages(filtered);
                onMemoryReload?.();
                return;
              }
            }
          }
        } catch {}

        elapsed += POLL_INTERVAL;
        if (elapsed >= MAX_TIMEOUT) {
          isSendingRef.current = false;
          setStatus("error");
          setStreamingText("");
          pendingUserMsgRef.current = null;
          return;
        }

        if (isSendingRef.current) {
          fallbackTimerRef.current = setTimeout(pollForResponse, POLL_INTERVAL);
        }
      };

      fallbackTimerRef.current = setTimeout(pollForResponse, INITIAL_DELAY);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send", "error");
      pendingUserMsgRef.current = null;
      setStatus("error");
      isSendingRef.current = false;
      setStreamingText("");
    }
  }, [agentId, selectedSession, messages.length, getToken, knowledgeEnabled, enabledSources, onMemoryReload]);

  // ── Abort ──
  const abort = useCallback(async () => {
    if (!selectedSession || isAborting) return;
    setIsAborting(true);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.abortGatewayChat(token, agentId, selectedSession);

      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      isSendingRef.current = false;
      setStatus("idle");
      setStreamingText("");

      setTimeout(async () => {
        const t = await getToken();
        if (t && selectedSession) {
          const data = await apiClient.getSessionHistory(t, agentId, selectedSession);
          setMessages(filterSystemMessages(data.messages || []));
        }
      }, 500);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to abort", "error");
    } finally {
      setIsAborting(false);
    }
  }, [agentId, selectedSession, isAborting, getToken]);

  // ── Reload messages ──
  const reload = useCallback(async () => {
    const session = selectedSessionRef.current;
    if (!session) return;
    try {
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getSessionHistory(token, agentId, session, 500);
      setMessages(filterSystemMessages(data.messages || []));
    } catch {}
  }, [agentId, getToken]);

  return {
    // Session
    sessions,
    setSessions,
    selectedSession,
    selectSession,
    isConnecting,
    // Chat
    messages,
    setMessages,
    status,
    isSending: status === "sending" || status === "waiting",
    streamingText,
    send,
    abort,
    isAborting,
    reload,
  };
}
