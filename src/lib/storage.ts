import type { ChatMessage, Conversation, ImageAttachment } from "../types";

const KEY = "fortytwo-prime-chat:conversations";

function rid(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeMessage(raw: unknown): ChatMessage {
  const m = raw as Partial<ChatMessage>;
  const role =
    m.role === "user" || m.role === "assistant" || m.role === "system"
      ? m.role
      : "assistant";
  const content = typeof m.content === "string" ? m.content : "";
  let attachments: ImageAttachment[] | undefined;
  if (Array.isArray(m.attachments)) {
    attachments = m.attachments.filter(
      (a): a is ImageAttachment =>
        !!a &&
        typeof (a as ImageAttachment).id === "string" &&
        (a as ImageAttachment).type === "image" &&
        typeof (a as ImageAttachment).dataUrl === "string"
    );
    if (attachments.length === 0) attachments = undefined;
  }
  return {
    id: typeof m.id === "string" && m.id.length > 0 ? m.id : rid("m_"),
    role,
    content,
    attachments,
    createdAt: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
    edited: Boolean(m.edited),
    model: typeof m.model === "string" ? m.model : undefined,
    usage:
      m.usage && typeof m.usage === "object"
        ? {
            prompt_tokens:
              typeof m.usage.prompt_tokens === "number"
                ? m.usage.prompt_tokens
                : undefined,
            completion_tokens:
              typeof m.usage.completion_tokens === "number"
                ? m.usage.completion_tokens
                : undefined,
            total_tokens:
              typeof m.usage.total_tokens === "number"
                ? m.usage.total_tokens
                : undefined,
            cost: typeof m.usage.cost === "number" ? m.usage.cost : undefined,
          }
        : undefined,
    error: Boolean(m.error),
  };
}

/** Coerce unknown JSON into valid conversations (avoids runtime crashes on bad imports / legacy data). */
function normalizeConversation(raw: unknown): Conversation {
  const c = raw as Partial<Conversation>;
  const now = Date.now();
  const messages = Array.isArray(c.messages)
    ? c.messages.map(normalizeMessage)
    : [];
  return {
    id: typeof c.id === "string" && c.id.length > 0 ? c.id : rid("c_"),
    title: typeof c.title === "string" ? c.title : "Chat",
    messages,
    createdAt: typeof c.createdAt === "number" ? c.createdAt : now,
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : now,
    pinned: Boolean(c.pinned),
    model: typeof c.model === "string" ? c.model : undefined,
    systemPrompt:
      typeof c.systemPrompt === "string" ? c.systemPrompt : undefined,
  };
}

export function normalizeConversations(raw: unknown[]): Conversation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeConversation(x));
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeConversations(parsed as unknown[]);
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(convs));
  } catch {
    // quota exceeded or storage unavailable -> ignore
  }
}
