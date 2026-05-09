/**
 * Vercel serverless proxy for Fortytwo MCP (Node.js runtime).
 *
 * The browser can't call `https://mcp.fortytwo.network/mcp` directly because
 * the server doesn't reply to CORS preflights. We forward the JSON-RPC body
 * and the small set of headers the Fortytwo protocol relies on, then pipe
 * the response (including SSE streams) back to the browser with permissive
 * CORS headers and the `payment-required` / `x-session-id` headers exposed.
 *
 * Uses Node.js instead of Edge: Edge invocation wall-time is too low for
 * settlement verification + streaming model output, which surfaced as HTTP 504.
 */

const FORTYTWO_ENDPOINT = "https://mcp.fortytwo.network/mcp";

/** Reject oversized POST bodies (abuse / accidental huge payloads). */
const MAX_PROXY_BODY_BYTES = 6 * 1024 * 1024;

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
  /** Lets the browser tell a Fortytwo 500 (relayed) from a Vercel/runtime crash. */
  "x-upstream-status",
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

/** Hobby: up to 300s, required so payment replay + SSE are not cut off with 504. */
export const maxDuration = 300;

async function proxyMcp(req: Request): Promise<Response> {
  let origin: string | null = null;
  try {
    origin = req.headers.get("origin");

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
    /** Avoid gzip + manual header stripping mismatches when relaying to the browser. */
    upstreamHeaders.set("Accept-Encoding", "identity");

    const contentLength = req.headers.get("content-length");
    if (contentLength != null && /^\d+$/.test(contentLength)) {
      const n = Number(contentLength);
      if (n > MAX_PROXY_BODY_BYTES) {
        return new Response(
          JSON.stringify({
            error: {
              code: -32600,
              message: "Request body too large",
            },
          }),
          {
            status: 413,
            headers: { "content-type": "application/json", ...corsHeaders(origin) },
          }
        );
      }
    }

    const body = await req.arrayBuffer();
    if (body.byteLength > MAX_PROXY_BODY_BYTES) {
      return new Response(
        JSON.stringify({
          error: {
            code: -32600,
            message: "Request body too large",
          },
        }),
        {
          status: 413,
          headers: { "content-type": "application/json", ...corsHeaders(origin) },
        }
      );
    }

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
    outHeaders.set("x-upstream-status", String(upstream.status));

    const contentType = upstream.headers.get("content-type") || "";
    const sse = contentType.includes("text/event-stream") && upstream.ok;

    // Buffer non-SSE bodies so error JSON / 402 payloads are not lost on Vercel.
    if (!sse) {
      const buf = await upstream.arrayBuffer();
      return new Response(buf, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    console.error("[api/mcp]", err);
    return new Response(
      JSON.stringify({
        error: {
          code: -32000,
          message: `proxy internal error: ${(err as Error).message}`,
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
}

/** Vercel "other" framework: must use Web Handler object, not `export default async function`. */
export default { fetch: proxyMcp };
