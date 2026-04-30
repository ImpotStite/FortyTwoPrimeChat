import type { ChatMessage } from "../types";

const MEMORY_QUERY_PREAMBLE =
  "Below is the prior conversation history in this chat (same thread). " +
  "Use it only for context. Your task is to answer the final user message after the separator.\n\n";

const HISTORY_START = "--- Conversation history ---\n";
const HISTORY_END = "\n--- End conversation history ---\n";
const CURRENT_HEADER = "\n--- Current user message ---\n";

function imageOmittedNote(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "[image omitted]" : `[${count} images omitted]`;
}

/** One line per message for the history block (English labels). */
function formatHistoryMessageLine(m: ChatMessage): string {
  const label = m.role === "user" ? "User" : "Assistant";
  let body = (m.content ?? "").trim();
  const nImg = m.attachments?.length ?? 0;
  if (nImg > 0) {
    const note = imageOmittedNote(nImg);
    body = body ? `${body}\n${note}` : note;
  }
  return `${label}: ${body}`;
}

/**
 * Build the `query` string sent to `ask_fortytwo_prime`.
 * When memory is off or there is no prior turns, returns only the current user text.
 */
export function buildPrimeWireQuery(opts: {
  memoryEnabled: boolean;
  messages: ChatMessage[];
  assistantMessageId: string;
  currentUserMessage: string;
}): string {
  const { memoryEnabled, messages, assistantMessageId, currentUserMessage } =
    opts;
  const trimmed = currentUserMessage.trim();
  const assistantIndex = messages.findIndex((m) => m.id === assistantMessageId);
  if (assistantIndex < 0) return trimmed;

  const priorTurns = messages.slice(0, assistantIndex - 1);
  if (!memoryEnabled || priorTurns.length === 0) return trimmed;

  const historyBlock = priorTurns.map(formatHistoryMessageLine).join("\n\n");
  return (
    MEMORY_QUERY_PREAMBLE +
    HISTORY_START +
    historyBlock +
    HISTORY_END +
    CURRENT_HEADER +
    trimmed
  );
}
