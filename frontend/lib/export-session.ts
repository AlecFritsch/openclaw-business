import type { ChatMessage } from "@/components/workspace/chat-panel";
import { renderContent, sanitizeUserContent, sanitizeAssistantContent } from "@/components/workspace/chat-panel";

export interface ExportOptions {
  includeToolCalls?: boolean;
  includeMetadata?: boolean;
  includeCodeBlocks?: boolean;
}

/**
 * Export chat messages as Markdown.
 * User messages: ## User\n{content}
 * Assistant messages: ## Assistant\n{content}
 * Options: tool calls, timestamps, code block formatting.
 */
export function exportMessagesAsMarkdown(messages: ChatMessage[], options: ExportOptions = {}): string {
  const { includeToolCalls = false, includeMetadata = false } = options;
  const lines: string[] = [];
  lines.push("# Chat Export");
  lines.push("");
  lines.push(`Exported at ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const parts: string[] = [];
    const text = extractMessageText(msg);
    if (text.trim()) parts.push(text.trim());

    if (includeToolCalls && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const b = block as { type?: string; name?: string; input?: any; content?: any };
        if (b.type === "tool_use") {
          parts.push(`### Tool: ${b.name || "unknown"}\n\`\`\`json\n${JSON.stringify(b.input ?? {}, null, 2)}\n\`\`\``);
        } else if (b.type === "tool_result") {
          const res = Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? JSON.stringify(c)).join("\n") : (typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? {}));
          parts.push(`### Result\n\`\`\`\n${res.slice(0, 2000)}${res.length > 2000 ? "\n...[truncated]" : ""}\n\`\`\``);
        }
      }
    }

    if (parts.length === 0 && !includeToolCalls) continue;
    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${role}`);
    if (includeMetadata && msg.timestamp) {
      lines.push(`*${new Date(msg.timestamp).toLocaleString()}*`);
      lines.push("");
    }
    lines.push(parts.join("\n\n"));
    lines.push("");
  }

  return lines.join("\n");
}

function extractMessageText(msg: ChatMessage): string {
  if (msg.role === "user") {
    return sanitizeUserContent(renderContent(msg.content));
  }
  if (msg.role === "assistant") {
    const content = msg.content;
    if (typeof content === "string") {
      return sanitizeAssistantContent(content);
    }
    if (Array.isArray(content)) {
      return content
        .map((block) => {
          const t = (block as { type?: string })?.type;
          if (t === "tool_use" || t === "tool_result") return "";
          return (block as { text?: string }).text ?? "";
        })
        .filter(Boolean)
        .map(sanitizeAssistantContent)
        .join("\n\n");
    }
    if (content && typeof content === "object") {
      return sanitizeAssistantContent((content as { text?: string }).text ?? "");
    }
  }
  return "";
}

/** Trigger browser download of a markdown file. */
export function downloadMarkdown(content: string, filename: string = "chat-export.md"): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
