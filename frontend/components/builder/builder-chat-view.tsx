"use client";

import { useMemo, createContext, useContext, useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ChevronDown, Check } from "lucide-react";
import {
  AssistantIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { HavocChatRuntime } from "@/lib/havoc-chat-runtime";
import type { ChatMessage } from "@/components/workspace/chat-panel";
import { MarkdownText } from "@/components/markdown-text";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { ProviderIcon } from "@/components/provider-icon";

/** Adapter: assistant-ui passes `text`, MarkdownText expects `content` */
const MarkdownTextPart = (props: { text?: string; content?: string }) => (
  <MarkdownText content={props.text ?? props.content ?? ""} />
);

export interface BuilderChatMessage {
  role: "assistant" | "user";
  content: string;
  toolSteps?: { tool: string; query?: string; category?: string }[];
  config?: any; // Config snapshot for this message
}

interface BuilderChatContextValue {
  messages: BuilderChatMessage[];
  typingStatus: string;
  searchedLabel: (q: string) => string;
  templatesLabel: (cat: string) => string;
  hasConfig?: boolean;
  onOpenConfig?: (config?: any) => void;
  onSend: (text: string) => Promise<void>;
}

const BuilderChatContext = createContext<BuilderChatContextValue>({
  messages: [],
  typingStatus: "Thinking...",
  searchedLabel: (q) => `Searched "${q}"`,
  templatesLabel: (c) => `Templates: ${c}`,
  hasConfig: false,
  onOpenConfig: undefined,
  onSend: async () => {},
});

function useBuilderChat() {
  return useContext(BuilderChatContext);
}

function builderToHavocMessages(
  messages: BuilderChatMessage[]
): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

interface BuilderChatViewProps {
  messages: BuilderChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<BuilderChatMessage[]>>;
  isTyping: boolean;
  typingStatus: string;
  onSend: (text: string) => Promise<void>;
  onAbort?: () => void;
  welcomeTitle: string;
  welcomeSubtitle: string;
  placeholder: string;
  sendLabel: string;
  searchedLabel: (q: string) => string;
  templatesLabel: (cat: string) => string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  availableModels?: string[];
  hasConfig?: boolean;
  onOpenConfig?: (config?: any) => void; // Pass config snapshot
}

export function BuilderChatView({
  messages,
  setMessages,
  isTyping,
  typingStatus,
  onSend,
  onAbort,
  welcomeTitle,
  welcomeSubtitle,
  placeholder,
  sendLabel,
  searchedLabel,
  templatesLabel,
  selectedModel,
  onModelChange,
  availableModels,
  hasConfig,
  onOpenConfig,
}: BuilderChatViewProps) {
  const havocMessages = useMemo(
    () => builderToHavocMessages(messages),
    [messages]
  );

  const setHavocMessages = useMemo(() => {
    return (action: React.SetStateAction<ChatMessage[]>) => {
      setMessages((prev) => {
        const next =
          typeof action === "function"
            ? action(builderToHavocMessages(prev))
            : action;
        return next.map((m) => ({
          role: m.role as "assistant" | "user",
          content: typeof m.content === "string" ? m.content : "",
        }));
      });
    };
  }, [setMessages]);

  const contextValue = useMemo(
    () => ({
      messages,
      typingStatus,
      searchedLabel,
      templatesLabel,
      hasConfig,
      onOpenConfig,
      onSend,
    }),
    [messages, typingStatus, searchedLabel, templatesLabel, hasConfig, onOpenConfig, onSend]
  );

  return (
    <BuilderChatContext.Provider value={contextValue}>
      <HavocChatRuntime
        messages={havocMessages}
        setMessages={setHavocMessages}
        isRunning={isTyping}
        streamingContent=""
        onSend={onSend}
        onAbort={onAbort}
      >
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-card">
          <ThreadPrimitive.Root
            className="aui-root aui-thread-root @container flex h-full flex-col bg-card"
            style={{ ["--thread-max-width" as string]: "56rem" }}
          >
            <ThreadPrimitive.Viewport
              turnAnchor="bottom"
              className="aui-thread-viewport relative flex flex-1 flex-col min-h-0 overflow-x-auto overflow-y-auto scroll-smooth px-4 sm:px-6 py-6"
            >
              <AssistantIf condition={(s) => s.thread.isEmpty}>
                <BuilderWelcome
                  title={welcomeTitle}
                  subtitle={welcomeSubtitle}
                />
              </AssistantIf>

              <ThreadPrimitive.Messages
                components={{
                  UserMessage: BuilderUserMessage,
                  AssistantMessage: BuilderAssistantMessage,
                }}
              />

              <AssistantIf condition={(s) => s.thread.isRunning}>
                <BuilderThinking typingStatus={typingStatus} />
              </AssistantIf>

              <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 left-0 right-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 overflow-visible pt-8 pb-4">
                <ThreadScrollToBottom />
                <BuilderComposer
                  placeholder={placeholder}
                  sendLabel={sendLabel}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                  availableModels={availableModels}
                />
              </ThreadPrimitive.ViewportFooter>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </div>
      </HavocChatRuntime>
    </BuilderChatContext.Provider>
  );
}

function ThreadScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        type="button"
        className="aui-thread-scroll-to-bottom absolute -top-10 z-10 self-center rounded-full p-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-foreground hover:bg-muted disabled:invisible transition-colors"
        aria-label="Scroll to bottom"
      >
        <ArrowDown className="size-4" strokeWidth={2} />
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
}

function BuilderWelcome({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="aui-thread-welcome-root mx-auto flex w-full max-w-(--thread-max-width) grow flex-col items-center justify-end pb-8">
      <div className="text-center space-y-4 max-w-lg">
        <h1 className="text-lg sm:text-xl font-normal tracking-tight text-foreground">
          {title}
        </h1>
        <div className="text-sm text-muted-foreground leading-relaxed">
          <MarkdownText content={subtitle} />
        </div>
      </div>
    </div>
  );
}

function BuilderThinking({ typingStatus }: { typingStatus: string }) {
  return (
    <div className="aui-thread-thinking mx-auto w-full max-w-(--thread-max-width) py-4 flex items-center justify-start" data-role="assistant">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex gap-0.5">
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "120ms" }} />
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "240ms" }} />
        </span>
        <span>{typingStatus}</span>
      </span>
    </div>
  );
}

function BuilderUserMessage() {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root mx-auto w-full max-w-(--thread-max-width) flex justify-end py-2"
      data-role="user"
    >
      <div className="max-w-[85%] sm:max-w-[480px]">
        <div className="rounded-2xl rounded-tr-sm bg-neutral-900 dark:bg-neutral-800 px-4 py-2.5 text-sm font-normal leading-relaxed text-white">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function BuilderAssistantMessage() {
  const t = useTranslations("builder");
  const { messages, onOpenConfig } = useBuilderChat();
  const messageIndex = useMessageIndex();

  const message = messageIndex >= 0 ? messages[messageIndex] : undefined;
  const toolSteps = message?.role === "assistant" ? message.toolSteps : undefined;
  const messageConfig = message?.role === "assistant" ? message.config : undefined;

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root mx-auto w-full max-w-(--thread-max-width) flex justify-start py-2"
      data-role="assistant"
    >
      <div className="max-w-[90%] sm:max-w-[640px] text-sm font-normal leading-relaxed text-foreground space-y-3">
        {toolSteps && toolSteps.length > 0 && (
          <ToolStepsPills toolSteps={toolSteps} />
        )}
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownTextPart,
          }}
        />
        {messageConfig && onOpenConfig && (
          <button
            onClick={() => onOpenConfig(messageConfig)}
            className="mt-3 px-3 py-1.5 text-xs font-medium bg-foreground text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Review & Deploy →
          </button>
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

/** Get current assistant message index for toolSteps lookup */
function useMessageIndex(): number {
  const message = useMessage();
  const id = (message as { id?: string }).id ?? "";
  const match = id.match(/^msg_(\d+)$/);
  return match ? parseInt(match[1]!, 10) : -1;
}

function ToolStepsPills({
  toolSteps,
}: {
  toolSteps: { tool: string; query?: string; category?: string }[];
}) {
  const { searchedLabel: sl, templatesLabel: tl } = useBuilderChat();

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {toolSteps.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 border border-gray-200/60 dark:border-border/50 rounded-lg px-2.5 py-1"
        >
          <span className="text-muted-foreground shrink-0">
            {s.tool === "web_search" ? "→" : "○"}
          </span>
          {s.tool === "web_search" ? sl(s.query ?? "") : tl(s.category ?? "all")}
        </span>
      ))}
    </div>
  );
}

interface BuilderComposerProps {
  placeholder: string;
  sendLabel: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  availableModels?: string[];
}

function BuilderComposer({ placeholder, sendLabel, selectedModel, onModelChange, availableModels }: BuilderComposerProps) {
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const models = (availableModels && availableModels.length > 0
    ? availableModels
    : ['google/gemini-3-flash-preview']
  ).map(id => ({
    id,
    name: id.split('/').slice(1).join('/').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    provider: id.split('/')[0],
  }));

  const activeModel = selectedModel || 'google/gemini-3-flash-preview';
  const displayName = models.find(m => m.id === activeModel)?.name || 'Model';

  useEffect(() => {
    if (!isModelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isModelPickerOpen]);

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <div className="flex w-full flex-col rounded-2xl border border-border bg-white dark:bg-neutral-900 px-3 py-2 outline-none ring-0 transition-colors focus-within:border-gray-300 dark:focus-within:border-gray-600">
        <ComposerPrimitive.Input
          placeholder={placeholder}
          className="aui-composer-input min-h-11 max-h-28 w-full resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <div className="flex items-center justify-between -mt-1">
          {/* Model Picker */}
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setIsModelPickerOpen(!isModelPickerOpen)}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium transition-all ${
                isModelPickerOpen
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              }`}
            >
              <ProviderIcon provider={activeModel.split("/")[0]} size={13} />
              <span className="max-w-[90px] truncate">{displayName}</span>
              <ChevronDown className={`w-2.5 h-2.5 opacity-40 transition-transform ${isModelPickerOpen ? "rotate-180" : ""}`} strokeWidth={3} />
            </button>

            {isModelPickerOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-60 bg-popover border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden backdrop-blur-sm">
                <div className="px-3 py-2 border-b border-border/40">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">Model</span>
                </div>
                <div className="py-1">
                  {models.map((m) => {
                    const isActive = m.id === activeModel;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onModelChange?.(m.id);
                          setIsModelPickerOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-foreground/[0.06]"
                            : "hover:bg-foreground/[0.04]"
                        }`}
                      >
                        <ProviderIcon provider={m.provider} size={14} />
                        <span className={`text-sm truncate ${isActive ? "font-medium text-foreground" : "text-foreground/80"}`}>
                          {m.name}
                        </span>
                        {isActive && (
                          <Check className="w-3.5 h-3.5 ml-auto text-foreground/50 shrink-0" strokeWidth={2.5} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Send Button */}
          <div className="flex items-center">
            <AssistantIf condition={(s) => !s.thread.isRunning}>
              <ComposerPrimitive.Send asChild>
                <TooltipIconButton
                  tooltip={sendLabel}
                  side="bottom"
                  type="submit"
                  variant="default"
                  size="icon"
                  className="aui-composer-send size-8 rounded-full"
                  aria-label={sendLabel}
                >
                  <ArrowUpIcon className="aui-composer-send-icon size-4" />
                </TooltipIconButton>
              </ComposerPrimitive.Send>
            </AssistantIf>
            <AssistantIf condition={(s) => s.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="aui-composer-cancel size-8 rounded-full"
                  aria-label="Stop"
                >
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              </ComposerPrimitive.Cancel>
            </AssistantIf>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}

