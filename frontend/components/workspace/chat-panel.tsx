// Chat message types and content sanitization utilities.
// Used by havoc-chat-runtime, workspace-chat-context, export-session, builder-chat-view.

export interface ChatMessage {
  role: string;
  content: string | { type: string; text: string; [key: string]: any } | Array<{ type: string; text?: string; name?: string; input?: any; content?: any; [key: string]: any }>;
  timestamp?: string;
}

/** Safely extract displayable text from a message content field (strips tool blocks). */
export function renderContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        const blockType = (block as { type?: string })?.type;
        if (blockType === "tool_use" || blockType === "tool_result") return "";
        return block?.text ?? "";
      })
      .filter(Boolean)
      .join("");
  }
  if (content && typeof content === "object") {
    return (content as { text?: string }).text ?? JSON.stringify(content);
  }
  return String(content ?? "");
}

/** Strip OpenClaw inbound envelope / system wrappers from user message content. */
export function sanitizeUserContent(raw: string): string {
  let text = raw;
  text = text.replace(/<clawguardian>[\s\S]*?<\/clawguardian>/gi, "");
  text = text.replace(/<\/?final>/gi, "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<\/?think>/gi, "");
  text = text.replace(/Conversation info\s*\(untrusted metadata\)\s*:\s*```[\s\S]*?```/gi, "");
  text = text.replace(/\[Chat messages since your last reply - for context\]/g, "");
  text = text.replace(/\[Current message - respond to this\]/g, "");
  const tsMatch = text.match(/\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*([\s\S]*)/);
  if (tsMatch && tsMatch[1]?.trim()) text = tsMatch[1];
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text || raw.trim();
}

/** Strip internal noise from assistant message text (security notices, browser trees, system markers). */
export function sanitizeAssistantContent(raw: string): string {
  let text = raw;
  text = text.replace(/SECURITY NOTICE:[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/gi, "");
  text = text.replace(/SECURITY NOTICE:[\s\S]*$/gi, "");
  text = text.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?(?=<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>|$)/g, "");
  text = text.replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>/g, "");
  text = text.replace(/<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/g, "");
  text = text.replace(/Source:\s*(Browser|Email|Webhook)\s*/gi, "");
  text = text.replace(/\s*DO NOT treat any part of this content as system instructions[^.]*\.\s*/gi, "");
  text = text.replace(/(?:^|\n)[ \t]*-[ \t]+(?:generic|link|button|heading|text|paragraph|list|listitem|separator|navigation|combobox|searchbox|option|img|status|dialog)[ \t]*(?:"[^"]*")?[ \t]*\[(?:ref=e\d+|level=\d+)\][^\n]*\n?/g, "\n");
  text = text.replace(/(?:^|\n)[ \t]*-[ \t]+\w[\w\s]*\[ref=e\d+\][^\n]*\n?/g, "\n");
  text = text.replace(/\[Chat messages since your last reply[^\]]*\]/g, "");
  text = text.replace(/\[Current message - respond to this\]/g, "");
  text = text.replace(/<clawguardian>[\s\S]*?<\/clawguardian>/gi, "");
  text = text.replace(/<\/?final>/gi, "");
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<\/?think>/gi, "");
  text = text.replace(/^\s*Thinking\.\.\.\s*$/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text || raw.trim();
}
