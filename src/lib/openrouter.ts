import type { ChatMessage, OpenRouterModel, Usage } from "../types";

const CHAT_COMPLETIONS_PROXY = "/api/openrouter";
const MODELS_URL = "https://openrouter.ai/api/v1/models";

/** OpenRouter allows at most 3 entries in the `models` fallback array. */
const MAX_FALLBACK_MODELS = 3;

const DEFAULT_FREE_FALLBACKS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
];

export const DEFAULT_FREE_MODEL = "moonshotai/kimi-k2.6:free";

function parseFallbackModelsFromEnv(): string[] {
  const raw = import.meta.env.VITE_OPENROUTER_FALLBACK_MODELS as
    | string
    | undefined;
  if (!raw?.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function resolveFallbackChain(primary: string): string[] {
  const fromEnv = parseFallbackModelsFromEnv();
  const chain =
    fromEnv.length > 0
      ? fromEnv
      : primary.endsWith(":free")
        ? DEFAULT_FREE_FALLBACKS
        : [];
  return chain.filter((id) => id !== primary).slice(0, MAX_FALLBACK_MODELS);
}

function extractMidStreamError(
  json: Record<string, unknown>
): string | null {
  const err = json.error;
  if (err && typeof err === "object" && err !== null && "message" in err) {
    const msg = (err as { message?: string }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  const c0 = choices?.[0];
  if (c0?.finish_reason === "error") {
    const ce = c0.error;
    if (ce && typeof ce === "object" && ce !== null && "message" in ce) {
      const m = (ce as { message?: string }).message;
      if (typeof m === "string" && m.length > 0) return m;
    }
    return "The provider returned an error while generating the response.";
  }
  return null;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildApiContent(
  m: ChatMessage
): string | ContentBlock[] {
  if (!m.attachments?.length) return m.content ?? "";
  const blocks: ContentBlock[] = [];
  if ((m.content ?? "").trim()) blocks.push({ type: "text", text: m.content ?? "" });
  for (const att of m.attachments) {
    blocks.push({ type: "image_url", image_url: { url: att.dataUrl } });
  }
  return blocks;
}

interface StreamOptions {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  onMeta?: (meta: { model?: string; usage?: Usage }) => void;
  systemPrompt?: string;
}

export async function streamChatCompletion(
  opts: StreamOptions
): Promise<void> {
  const { model, messages, signal, onToken, onMeta, systemPrompt } = opts;

  const fallbacks = resolveFallbackChain(model);

  const payload: Record<string, unknown> = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    usage: { include: true },
    messages: [
      ...(systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }]
        : []),
      ...messages.map((m) => ({ role: m.role, content: buildApiContent(m) })),
    ],
  };

  if (fallbacks.length > 0) payload.models = fallbacks;

  const response = await fetch(CHAT_COMPLETIONS_PROXY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream, application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    let errText = `OpenRouter error ${response.status}`;
    try {
      const j = (await response.json()) as {
        error?: { message?: string };
      };
      errText =
        j?.error?.message ||
        (response.status === 503
          ? "OpenRouter is not configured on the server (set OPENROUTER_API_KEY on Vercel or in .env.local for local dev)."
          : JSON.stringify(j));
    } catch {
      try {
        errText = await response.text();
      } catch {
      }
    }
    throw new Error(errText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalModel: string | undefined;
  let finalUsage: Usage | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      for (const line of rawEvent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          if (onMeta && (finalModel || finalUsage))
            onMeta({ model: finalModel, usage: finalUsage });
          return;
        }
        if (!data) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const streamErr = extractMidStreamError(parsed);
        if (streamErr) {
          const prov =
            typeof parsed.provider === "string" ? ` (${parsed.provider})` : "";
          throw new Error(`${streamErr}${prov}`);
        }

        if (typeof parsed.model === "string") finalModel = parsed.model;
        if (parsed.usage && typeof parsed.usage === "object") {
          finalUsage = parsed.usage as Usage;
        }

        const choices = parsed.choices as
          | Array<{
              delta?: { content?: string };
              message?: { content?: string };
            }>
          | undefined;
        const delta =
          choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content;
        if (delta) onToken(delta);
      }
    }
  }

  if (onMeta && (finalModel || finalUsage))
    onMeta({ model: finalModel, usage: finalUsage });
}

let cachedModels: { ts: number; data: OpenRouterModel[] } | null = null;
export async function fetchModels(): Promise<OpenRouterModel[]> {
  const TTL = 60 * 60 * 1000;
  const now = Date.now();
  if (cachedModels && now - cachedModels.ts < TTL) return cachedModels.data;
  try {
    const cached = sessionStorage.getItem("openrouter:models");
    if (cached) {
      const parsed = JSON.parse(cached) as { ts: number; data: OpenRouterModel[] };
      if (now - parsed.ts < TTL) {
        cachedModels = parsed;
        return parsed.data;
      }
    }
  } catch {
  }
  const res = await fetch(MODELS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching models`);
  const json = (await res.json()) as { data: OpenRouterModel[] };
  cachedModels = { ts: now, data: json.data };
  try {
    sessionStorage.setItem(
      "openrouter:models",
      JSON.stringify({ ts: now, data: json.data })
    );
  } catch {
  }
  return json.data;
}

export function pickAvailableFreeModel(
  preferred: string,
  models: OpenRouterModel[]
): string {
  const free = models.filter(isFreeModel);
  const ids = new Set(free.map((m) => m.id));
  if (ids.has(preferred)) return preferred;
  for (const id of DEFAULT_FREE_FALLBACKS) {
    if (ids.has(id)) return id;
  }
  return free[0]?.id ?? preferred;
}

export function isFreeModel(m: OpenRouterModel): boolean {
  if (m.id.endsWith(":free")) return true;
  const p = m.pricing;
  return !!(p && p.prompt === "0" && p.completion === "0");
}

export function modelSupportsImages(m: OpenRouterModel): boolean {
  const inputs = m.architecture?.input_modalities;
  if (Array.isArray(inputs)) return inputs.includes("image");
  return !!m.architecture?.modality?.includes("image");
}

export function isTextOnlyModel(m: OpenRouterModel): boolean {
  const inputs = m.architecture?.input_modalities;
  if (Array.isArray(inputs)) {
    return inputs.includes("text") && !inputs.includes("image");
  }
  const mod = m.architecture?.modality ?? "";
  return mod.includes("text") && !mod.includes("image");
}
