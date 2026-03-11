"use client";

import { Thread } from "@/components/thread";
import { WorkspaceChatProvider } from "@/lib/workspace-chat-context";
import { useTranslations } from "next-intl";
import type { ChatMessage } from "@/components/workspace/chat-panel";

interface HavocChatViewProps {
  agentId?: string;
  sessionKey: string | null;
  messages?: ChatMessage[];
  isConnecting: boolean;
}

export function HavocChatView({ agentId, sessionKey, messages = [], isConnecting, knowledgeEnabled, setKnowledgeEnabled, enabledSources, toggleSource }: HavocChatViewProps & { knowledgeEnabled?: boolean; setKnowledgeEnabled?: (v: boolean) => void; enabledSources?: Set<string>; toggleSource?: (s: string) => void }) {
  const t = useTranslations("workspace.chatPanel");

  if (isConnecting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="flex gap-2">
          <span className="w-2 h-2 bg-gray-400 dark:bg-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-gray-400 dark:bg-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-gray-400 dark:bg-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-sm text-muted-foreground">{t("connecting")}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <WorkspaceChatProvider agentId={agentId} sessionKey={sessionKey} messages={messages} knowledgeEnabledProp={knowledgeEnabled} setKnowledgeEnabledProp={setKnowledgeEnabled} enabledSourcesProp={enabledSources} toggleSourceProp={toggleSource}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <Thread />
        </div>
      </WorkspaceChatProvider>
    </div>
  );
}

