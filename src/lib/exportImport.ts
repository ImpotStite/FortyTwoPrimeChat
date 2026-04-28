import type { Conversation } from "../types";
import { normalizeConversations } from "./storage";

export function downloadFile(
  filename: string,
  content: string,
  type = "text/plain"
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function conversationToMarkdown(c: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${c.title || "Chat"}`);
  lines.push("");
  lines.push(
    `> Exported ${new Date().toLocaleString()} · ${c.messages.length} messages`
  );
  if (c.model) lines.push(`> Model: \`${c.model}\``);
  lines.push("");
  for (const m of c.messages) {
    const who =
      m.role === "user" ? "🧑 You" : m.role === "assistant" ? "🤖 Assistant" : "⚙ System";
    lines.push(`## ${who}`);
    if (m.attachments?.length)
      lines.push(
        `_(${m.attachments.length} image attachment(s) — not embedded in Markdown export)_\n`
      );
    lines.push(m.content || "_(empty)_");
    if (m.usage?.total_tokens != null) {
      lines.push("");
      lines.push(
        `_Tokens: ${m.usage.total_tokens}${
          m.usage.cost != null ? ` · Cost: ${m.usage.cost.toFixed(5)} $` : ""
        }${m.model ? ` · Model: ${m.model}` : ""}_`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function exportConversationMarkdown(c: Conversation): void {
  const md = conversationToMarkdown(c);
  const safe = (c.title || "conversation").replace(/[^\w\-]+/g, "_").slice(0, 60);
  downloadFile(`${safe}.md`, md, "text/markdown;charset=utf-8");
}

export function exportConversationJson(c: Conversation): void {
  const safe = (c.title || "conversation").replace(/[^\w\-]+/g, "_").slice(0, 60);
  downloadFile(`${safe}.json`, JSON.stringify(c, null, 2), "application/json");
}

export function exportAllJson(convs: Conversation[]): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    conversations: convs,
  };
  downloadFile(
    `fortytwo-chat-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
}

export function parseImport(json: string): Conversation[] {
  const parsed = JSON.parse(json);
  if (Array.isArray(parsed))
    return normalizeConversations(parsed as unknown[]);
  if (parsed && Array.isArray(parsed.conversations))
    return normalizeConversations(parsed.conversations as unknown[]);
  if (parsed && parsed.id && Array.isArray(parsed.messages))
    return normalizeConversations([parsed as unknown]);
  throw new Error("Unrecognized import file format");
}
