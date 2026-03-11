import {
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/attachment";
import { useWorkspaceChat } from "@/lib/workspace-chat-context";
import { useThinkingLabel } from "@/lib/thinking-label-context";
import { ModelPickerButton, KnowledgeButton } from "@/components/workspace/model-skills-buttons";
import { MarkdownText } from "@/components/markdown-text";
import { extractMissionPlans, MissionPlanCard, MissionUpdateCard } from "@/components/workspace/mission-plan-card";

/** Adapter: assistant-ui passes `text`, our MarkdownText expects `content`. */
const MarkdownTextPart = (props: { text?: string; content?: string }) => (
  <MarkdownText content={props.text ?? props.content ?? ""} />
);

const MissionAwareTextPart = (props: { text?: string; content?: string }) => {
  const text = props.text ?? props.content ?? "";
  const plans = useMemo(() => extractMissionPlans(text), [text]);
  if (plans.length > 0) {
    return (
      <>
        {plans.map((plan, i) => {
          if ("_action" in plan && (plan as any)._action === "update") {
            return <MissionUpdateCard key={`upd-${i}`} plan={plan as any} />;
          }
          const p = plan as { name: string; description?: string; trigger: any; prompt: string; capabilities?: string[]; delivery?: { channel?: string; target?: string } };
          return <MissionPlanCard key={`${p.name}-${i}`} plan={p} messageText={text} />;
        })}
      </>
    );
  }
  return <MarkdownText content={text} />;
};
import { ToolFallback } from "@/components/tool-fallback";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AssistantIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { useComposer, useComposerRuntime } from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  SquareIcon,
} from "lucide-react";
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { TextShimmer } from "@/components/landing/TextShimmer";
import { useTranslations } from "next-intl";
import type { FC } from "react";

export const Thread: FC = () => {
  return (
    <ErrorBoundary>
      <ThreadPrimitive.Root
        className="aui-root aui-thread-root @container flex h-full flex-col"
        style={{
          ["--thread-max-width" as string]: "64rem",
        }}
      >
        <ThreadPrimitive.Viewport
          turnAnchor="bottom"
          className="aui-thread-viewport relative flex flex-1 flex-col min-h-0 overflow-x-auto overflow-y-auto scroll-smooth px-4 md:px-6 pt-4"
        >
          <AssistantIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AssistantIf>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />

          <AssistantIf condition={(s) => s.thread.isRunning}>
            <ThreadThinking />
          </AssistantIf>

          <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 overflow-visible pb-4 md:pb-5 pt-4">
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </ErrorBoundary>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-3 text-center">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-normal text-lg md:text-xl duration-200 tracking-tight">
            Welcome to the workspace
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-sm mt-1.5 delay-75 duration-200 max-w-sm mx-auto text-center">
            Start a conversation with your agent. Delegate tasks, automate workflows, or ask questions.
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return null;
};

const ThreadThinking: FC = () => {
  const t = useTranslations("workspace.chatPanel");
  const dynamicLabel = useThinkingLabel();
  const label = dynamicLabel || t("thinking") || "Thinking...";
  return (
    <div
      className="aui-thread-thinking mx-auto w-full max-w-(--thread-max-width) py-4 flex items-center justify-start"
      data-role="assistant"
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="flex gap-0.5">
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "120ms" }} />
          <span className="w-1 h-1 bg-current rounded-full opacity-60 animate-bounce" style={{ animationDelay: "240ms" }} />
        </span>
        <TextShimmer as="span" duration={2}>
          {label}
        </TextShimmer>
      </span>
    </div>
  );
};

/** Slash commands shown in chat input popup (OpenClaw-compatible) */
const SLASH_COMMANDS = [
  { cmd: "/model", desc: "Switch model", action: "model" as const },
  { cmd: "/new", desc: "Start fresh session", action: "new" as const },
  { cmd: "/abort", desc: "Stop current run", action: "abort" as const },
  { cmd: "/reset", desc: "Reset session", action: "send" as const },
  { cmd: "/compact", desc: "Compress context", action: "send" as const },
  { cmd: "/think", desc: "Set thinking level", action: "send" as const },
  { cmd: "/status", desc: "Gateway status", action: "send" as const },
  { cmd: "/context", desc: "Context usage", action: "send" as const },
  { cmd: "/usage", desc: "Token usage", action: "send" as const },
];

const Composer: FC = () => {
  const t = useTranslations("workspace.chatPanel");
  const text = useComposer((s) => s.text);
  const runtime = useComposerRuntime();
  const [slashSelected, setSlashSelected] = useState(0);
  const [missionMode, setMissionMode] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Listen for mission creator event
  useEffect(() => {
    const open = () => {
      setMissionMode(true);
      runtime.setText("");
      setTimeout(() => {
        const el = inputRef.current ?? document.querySelector<HTMLTextAreaElement>(".aui-composer-input");
        el?.focus();
      }, 50);
    };
    const close = () => setMissionMode(false);
    window.addEventListener("open-mission-creator", open);
    window.addEventListener("close-mission-mode", close);
    return () => {
      window.removeEventListener("open-mission-creator", open);
      window.removeEventListener("close-mission-mode", close);
    };
  }, [runtime]);

  // Keyboard shortcut: Cmd+M / Ctrl+M to toggle mission mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "m") {
        e.preventDefault();
        setMissionMode((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Broadcast mission mode state
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mission-mode-change", { detail: { active: missionMode } }));
  }, [missionMode]);

  // Derive slash filter from current text
  const lastLine = text.split("\n").pop() ?? "";
  const slashIdx = lastLine.lastIndexOf("/");
  const slashFilter = slashIdx >= 0 ? lastLine.slice(slashIdx) : "";
  const slashFilterLower = slashFilter.toLowerCase().replace(/^\//, "");

  const slashFiltered = useMemo(
    () => slashFilter ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).toLowerCase().startsWith(slashFilterLower)) : [],
    [slashFilter, slashFilterLower],
  );
  const slashOpen = slashFiltered.length > 0;

  // Reset selection when filter changes
  useEffect(() => { setSlashSelected(0); }, [slashFilter]);

  const handleSlashSelect = useCallback(
    (entry: typeof SLASH_COMMANDS[number]) => {
      // Clear the slash text from input first
      const lines = text.split("\n");
      const last = lines.pop() ?? "";
      const idx = last.lastIndexOf("/");
      const before = [...lines, last.slice(0, idx)].join("\n");

      if (entry.action === "model") {
        runtime.setText(before);
        window.dispatchEvent(new Event("open-model-picker"));
      } else if (entry.action === "new") {
        runtime.setText("");
        // Clear messages — next send creates a new session automatically
        window.dispatchEvent(new Event("slash-new-session"));
      } else if (entry.action === "abort") {
        runtime.setText(before);
        runtime.cancel();
      } else {
        // "send" — put command as text and send it to the agent
        runtime.setText(entry.cmd);
        // Small delay so setText propagates before send
        setTimeout(() => runtime.send(), 0);
      }
    },
    [text, runtime],
  );

  // Intercept arrow/enter/escape for slash popup
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!slashOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelected((i) => Math.min(i + 1, slashFiltered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const entry = slashFiltered[Math.min(slashSelected, slashFiltered.length - 1)];
        if (entry) handleSlashSelect(entry);
      } else if (e.key === "Escape") {
        e.preventDefault();
        runtime.setText(text.slice(0, text.lastIndexOf("/")));
      }
    },
    [slashOpen, slashFiltered, slashSelected, handleSlashSelect, runtime, text],
  );

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone className="aui-composer-attachment-dropzone flex w-full flex-col rounded-2xl border border-border/30 bg-background shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.2)] px-1 pt-1.5 outline-none ring-0 transition-all focus-within:border-border/50 focus-within:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.1)] dark:focus-within:shadow-[0_2px_12px_-2px_rgba(0,0,0,0.3)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-muted/30">
        <ComposerAttachments />
        <div className="relative">
          {slashOpen && (
            <div ref={listRef} className="absolute bottom-full left-2 right-2 mb-1 py-1.5 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
              <div className="px-2 py-1 text-xs text-muted-foreground border-b border-border/60">Commands</div>
              {slashFiltered.map((c, i) => (
                <button
                  key={c.cmd}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSlashSelect(c); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    i === slashSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-muted-foreground"
                  }`}
                >
                  <span className="font-mono">{c.cmd}</span>
                  <span className="text-muted-foreground/70 truncate text-sm">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          <ComposerPrimitive.Input
            placeholder={missionMode ? t("missionPlaceholder") : t("placeholder")}
            className={`aui-composer-input mb-1 max-h-28 min-h-11 w-full resize-none bg-transparent px-3 pt-1.5 pb-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0 ${missionMode ? "placeholder:text-purple-400 dark:placeholder:text-purple-500" : ""}`}
            rows={1}
            autoFocus
            aria-label="Message input"
            onKeyDown={handleKeyDown}
          />
        </div>
        <ComposerAction />
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const MissionModeButton: FC = () => {
  const t = useTranslations("workspace.chatPanel");
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      setActive((e as CustomEvent).detail?.active ?? false);
    };
    window.addEventListener("mission-mode-change", handler);
    return () => window.removeEventListener("mission-mode-change", handler);
  }, []);

  const toggle = () => {
    if (active) window.dispatchEvent(new CustomEvent("close-mission-mode"));
    else window.dispatchEvent(new CustomEvent("open-mission-creator"));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`h-6 px-2 rounded-md text-xs font-medium transition-colors border ${
        active
          ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-300/30 dark:border-purple-700/30"
          : "bg-card/75 text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/60 border-border/50"
      }`}
      title="⌘M"
    >
      {t("modeMission")}
    </button>
  );
};

const ComposerAction: FC = () => {
  const t = useTranslations("workspace.chatPanel");

  return (
    <div className="aui-composer-action-wrapper relative mx-1.5 mb-1.5 flex items-center justify-between">
      <div className="flex items-center gap-1">
        <MissionModeButton />
        <ModelPickerButton />
        <KnowledgeButton />
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <AssistantIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label="Send message"
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
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AssistantIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) flex justify-start animate-in py-2 duration-150"
      data-role="assistant"
    >
      <div className="max-w-[90%] sm:max-w-[640px]">
        <div className="aui-assistant-message-content wrap-break-word text-sm font-normal leading-relaxed text-foreground">
          <MessagePrimitive.Parts
            components={{
              Text: MissionAwareTextPart,
              tools: { Fallback: ToolFallback },
            }}
          />
          <MessageError />
        </div>
        <div className="aui-assistant-message-footer mt-0.5 flex">
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-lg data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AssistantIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AssistantIf>
          <AssistantIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AssistantIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-1.5 px-1.5 py-2 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 max-w-[85%] sm:max-w-[480px]">
        <div className="aui-user-message-content wrap-break-word rounded-2xl rounded-tr-sm bg-neutral-900 dark:bg-neutral-800 px-4 py-2.5 text-sm font-normal leading-relaxed text-white">
          <MessagePrimitive.Parts />
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
