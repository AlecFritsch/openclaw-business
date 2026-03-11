"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import type { ChatMessage } from "@/components/workspace/chat-panel";

interface WorkspaceChatContextValue {
  agentId: string | undefined;
  sessionKey: string | null;
  messages: ChatMessage[];
  activeModel: string;
  setActiveModel: (m: string) => void;
  knowledgeEnabled: boolean;
  setKnowledgeEnabled: (v: boolean) => void;
  enabledSources: Set<string>;
  toggleSource: (source: string) => void;
}

const WorkspaceChatContext = createContext<WorkspaceChatContextValue>({
  agentId: undefined,
  sessionKey: null,
  messages: [],
  activeModel: "",
  setActiveModel: () => {},
  knowledgeEnabled: true,
  setKnowledgeEnabled: () => {},
  enabledSources: new Set(["platform", "google_drive", "notion"]),
  toggleSource: () => {},
});

export function WorkspaceChatProvider({
  agentId,
  sessionKey,
  messages = [],
  knowledgeEnabledProp,
  setKnowledgeEnabledProp,
  enabledSourcesProp,
  toggleSourceProp,
  children,
}: {
  agentId: string | undefined;
  sessionKey: string | null;
  messages?: ChatMessage[];
  knowledgeEnabledProp?: boolean;
  setKnowledgeEnabledProp?: (v: boolean) => void;
  enabledSourcesProp?: Set<string>;
  toggleSourceProp?: (source: string) => void;
  children: ReactNode;
}) {
  const { getToken } = useAuth();
  const [activeModel, setActiveModel] = useState("");
  const [knowledgeEnabledLocal, setKnowledgeEnabledLocal] = useState(true);
  const knowledgeEnabled = knowledgeEnabledProp ?? knowledgeEnabledLocal;
  const setKnowledgeEnabled = setKnowledgeEnabledProp ?? setKnowledgeEnabledLocal;
  const [enabledSourcesLocal, setEnabledSourcesLocal] = useState<Set<string>>(() => new Set(["platform", "google_drive", "notion"]));
  const enabledSources = enabledSourcesProp ?? enabledSourcesLocal;
  const toggleSourceLocal = useCallback((source: string) => {
    setEnabledSourcesLocal(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);
  const toggleSource = toggleSourceProp ?? toggleSourceLocal;

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const gwData = await apiClient.getGatewayConfig(token, agentId).catch(() => null);
        if (cancelled || !gwData?.config) return;
        const cfg = gwData.config;
        let model =
          cfg?.agents?.defaults?.model?.primary ||
          cfg?.agents?.defaults?.model ||
          cfg?.agents?.list?.[0]?.model?.primary ||
          cfg?.agents?.list?.[0]?.model ||
          "";
        if (typeof model === "object") model = (model as any).primary || "";
        if (model) setActiveModel(model);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [agentId, getToken]);

  return (
    <WorkspaceChatContext.Provider value={{ agentId, sessionKey, messages, activeModel, setActiveModel, knowledgeEnabled, setKnowledgeEnabled, enabledSources, toggleSource }}>
      {children}
    </WorkspaceChatContext.Provider>
  );
}

export function useWorkspaceChat() {
  return useContext(WorkspaceChatContext);
}
