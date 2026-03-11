"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
} from "@assistant-ui/react";
import type { ChatMessage } from "@/components/workspace/chat-panel";
import { renderContent, sanitizeUserContent, sanitizeAssistantContent } from "@/components/workspace/chat-panel";
import { ThinkingLabelProvider } from "@/lib/thinking-label-context";

/** Convert Havoc ChatMessage content block to assistant-ui content part. */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool-result"; toolCallId: string; result: unknown };

/** Convert Havoc ChatMessage[] to ThreadMessageLike[] for assistant-ui. */
function convertHavocToThreadMessages(
  messages: ChatMessage[],
  streamingContent?: string,
  isRunning?: boolean
): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const text = sanitizeUserContent(renderContent(msg.content));
      if (!text.trim()) continue;
      out.push({
        id: `msg_${i}`,
        role: "user",
        content: [{ type: "text" as const, text }],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const content = msg.content;
      const assistantParts: ContentPart[] = [];
      const toolResults: { id: string; content: unknown }[] = [];

      if (typeof content === "string") {
        const sanitized = sanitizeAssistantContent(content);
        if (sanitized.trim()) assistantParts.push({ type: "text", text: sanitized });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const t = (block as { type?: string })?.type;
          if (t === "tool_use") {
            const b = block as { id?: string; name?: string; input?: unknown };
            assistantParts.push({
              type: "tool-call",
              toolCallId: b.id || `tool_${i}_${out.length}`,
              toolName: b.name || "tool",
              args: (b.input as Record<string, unknown>) || {},
            });
          } else if (t === "tool_result") {
            const b = block as { id?: string; content?: unknown };
            toolResults.push({ id: b.id || "", content: b.content });
          } else {
            const text = (block as { text?: string }).text ?? "";
            if (text) {
              const sanitized = sanitizeAssistantContent(text);
              if (sanitized.trim()) assistantParts.push({ type: "text", text: sanitized });
            }
          }
        }
      } else if (content && typeof content === "object") {
        const text = (content as { text?: string }).text ?? JSON.stringify(content);
        const sanitized = sanitizeAssistantContent(text);
        if (sanitized.trim()) assistantParts.push({ type: "text", text: sanitized });
      }

      if (assistantParts.length > 0) {
        out.push({
          id: `msg_${i}`,
          role: "assistant",
          content: assistantParts as ThreadMessageLike['content'],
        });
      }

      if (toolResults.length > 0) {
        out.push({
          id: `tool_${i}`,
          role: "tool" as ThreadMessageLike["role"],
          content: toolResults.map((tr) => ({
            type: "tool-result" as const,
            toolCallId: tr.id,
            result: tr.content,
          })) as unknown as ThreadMessageLike['content'],
        });
      }
    }
  }

  // Append streaming assistant message when generating
  if (isRunning && streamingContent?.trim()) {
    const sanitized = sanitizeAssistantContent(streamingContent);
    if (sanitized.trim()) {
      out.push({
        id: `stream_${messages.length}`,
        role: "assistant",
        content: [{ type: "text" as const, text: sanitized }],
      });
    }
  }

  return out;
}

export interface HavocChatRuntimeProps {
  children: React.ReactNode;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isRunning: boolean;
  streamingContent: string;
  onSend: (text: string) => Promise<void>;
  onAbort?: () => void | Promise<void>;
}

export function HavocChatRuntime({
  children,
  messages,
  setMessages,
  isRunning,
  streamingContent,
  onSend,
  onAbort,
}: HavocChatRuntimeProps) {
  const [missionMode, setMissionModeState] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      setMissionModeState((e as CustomEvent).detail?.active ?? false);
    };
    window.addEventListener("mission-mode-change", handler);
    return () => window.removeEventListener("mission-mode-change", handler);
  }, []);

  const threadMessages = useMemo(
    () => convertHavocToThreadMessages(messages, streamingContent, isRunning),
    [messages, streamingContent, isRunning]
  );

  const onNew = useCallback(
    async (append: AppendMessage) => {
      const first = append.content[0];
      if (!first || (first as { type?: string }).type !== "text") return;
      let text = (first as { text?: string }).text ?? "";
      if (!text.trim()) return;

      if (missionMode) {
        text = `[HAVOC:MISSION_PLAN] The user wants to create or modify an autonomous mission. Analyze their request and respond with a JSON code block.

Available trigger types:
- "schedule" — cron expression (config: { expr: "0 9 * * *", tz?: "Europe/Berlin" })
- "interval" — recurring (config: { everyMs: 3600000 })
- "channel_message" — react to messages (config: { channel?: "whatsapp", filter?: "regex or keyword" })
- "webhook" — external HTTP trigger (config: { secret?: "..." })
- "mission_complete" — chain after another mission (config: { missionId: "..." })
- "manual" — on-demand only (config: {})

Use the agent's connected channels, tools, and integrations when planning.

For NEW missions:
\`\`\`json
{"name":"...","description":"...","trigger":{"type":"...","config":{}},"prompt":"autonomous instruction","capabilities":["browser","code","mcp"],"delivery":{"channel":"whatsapp","target":"#ops"}}
\`\`\`

For UPDATING existing missions (only include changed fields):
\`\`\`json
{"_action":"update","_missionId":"...","name":"new name","trigger":{"type":"schedule","config":{"expr":"0 8 * * *"}}}
\`\`\`

For MULTIPLE missions, use a JSON array. Do NOT execute anything — only output the plan JSON.

User request: ${text}`;
      }

      await onSend(text);
    },
    [onSend, missionMode]
  );

  const onCancel = useCallback(async () => {
    await onAbort?.();
  }, [onAbort]);

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    isRunning,
    convertMessage: (m) => m as ThreadMessageLike,
    onNew,
    onCancel,
  });

  const t = useTranslations("workspace.chatPanel");

  const thinkingLabel = isRunning ? (t("thinking") || "Thinking…") : "";

  return (
    <ThinkingLabelProvider label={thinkingLabel}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ThinkingLabelProvider>
  );
}
