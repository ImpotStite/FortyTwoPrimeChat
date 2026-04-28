/**
 * Vercel Function proxy for FortyTwo MCP.
 *
 * The browser can't call `https://mcp.fortytwo.network/mcp` directly because
 * the server doesn't reply to CORS preflights. We forward the JSON-RPC body
 * and the small set of headers the FortyTwo protocol relies on, then pipe
 * the response (including SSE streams) back to the browser with permissive
 * CORS headers and the `payment-required` / `x-session-id` headers exposed.
 */

const FORTYTWO_ENDPOINT = "https://mcp.fortytwo.network/mcp";

const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "x-session-id",
  "x-idempotency-key",
  "payment-signature",
];

const EXPOSED_RESPONSE_HEADERS = [
  "content-type",
  "x-session-id",
  "payment-required",
  "payment-response",
];

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": FORWARDED_REQUEST_HEADERS.join(", "),
    "Access-Control-Expose-Headers": EXPOSED_RESPONSE_HEADERS.join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request): Promise<Response> {
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

  const upstreamHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const v = req.headers.get(name);
    if (v) upstreamHeaders.set(name, v);
  }
  if (!upstreamHeaders.has("content-type")) {
    upstreamHeaders.set("content-type", "application/json");
  }
  if (!upstreamHeaders.has("accept")) {
    upstreamHeaders.set("accept", "text/event-stream, application/json");
  }

  const body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(FORTYTWO_ENDPOINT, {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          code: -32000,
          message: `proxy upstream error: ${(err as Error).message}`,
        },
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json",
          ...corsHeaders(origin),
        },
      }
    );
  }

  const outHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    outHeaders.set(k, v as string);
  }
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
