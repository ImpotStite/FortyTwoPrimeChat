/**
 * Vercel serverless proxy for OpenRouter chat completions (Node.js runtime).
 *
 * The browser never sees `OPENROUTER_API_KEY`; it POSTs the same JSON body
 * OpenRouter expects (built in `streamChatCompletion`) and this handler
 * attaches `Authorization` server-side.
 *
 * Node.js runtime matches `/api/mcp`: long SSE streams exceed Edge time limits.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const maxDuration = 300;

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function validMessageContent(c: unknown): boolean {
  if (typeof c === "string") return true;
  if (!Array.isArray(c)) return false;
  for (const block of c) {
    if (!block || typeof block !== "object") return false;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") continue;
    if (b.type === "image_url" && b.image_url && typeof b.image_url === "object") {
      const url = (b.image_url as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) continue;
    }
    return false;
  }
  return true;
}

function validatePayload(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (typeof o.model !== "string" || !o.model.trim() || o.model.length > 256) {
    return false;
  }
  if (o.stream !== true) return false;
  if (!Array.isArray(o.messages)) return false;
  if (o.messages.length === 0 || o.messages.length > 200) return false;
  for (const m of o.messages) {
    if (!m || typeof m !== "object") return false;
    const x = m as Record<string, unknown>;
    if (
      x.role !== "user" &&
      x.role !== "assistant" &&
      x.role !== "system"
    ) {
      return false;
    }
    if (!validMessageContent(x.content)) return false;
  }
  return true;
}

async function proxyOpenRouter(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, OPTIONS", ...corsHeaders(origin) },
    });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) {
    return new Response(
      JSON.stringify({
        error: { message: "Server is not configured (OPENROUTER_API_KEY)." },
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: { message: "Invalid JSON body" } }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  }

  if (!validatePayload(parsed)) {
    return new Response(
      JSON.stringify({ error: { message: "Invalid chat completion payload" } }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  }

  const referer = req.headers.get("referer") || "";

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": referer,
        "X-Title": "Fortytwo Prime Chat",
      },
      body: JSON.stringify(parsed),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: { message: `OpenRouter proxy error: ${(err as Error).message}` },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    outHeaders.set(k, v as string);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export default { fetch: proxyOpenRouter };
