/**
 * Fortytwo MCP client.
 *
 * Single endpoint: POST https://mcp.fortytwo.network/mcp (JSON-RPC 2.0).
 * Tool used: `ask_fortytwo_prime`.
 *
 * Payment flow (x402Escrow on Monad mainnet, USDC):
 *  1. Replay session if we already have one (header `x-session-id`).
 *  2. Otherwise call `tools/call` without signature → server replies HTTP 402
 *     with a base64 JSON `payment-required` payload listing accepted networks.
 *  3. Pick `eip155:143` (Monad), build an EIP-712 / EIP-3009
 *     `ReceiveWithAuthorization` for USDC, sign it with the user's wallet
 *     (via Privy → viem).
 *  4. Replay the same `tools/call` with `payment-signature` (base64 JSON) header.
 *  5. Server replies 200 with `x-session-id` and `payment-response` (txHash);
 *     cache them for follow-ups within the same billing session.
 *
 * Session lifetime (per https://docs.fortytwo.network/docs/mcp-integration):
 *  - 60 minutes hard cap from session opening
 *  - 10 minutes idle timeout
 *  - Closed earlier on budget-exhausted, dropped connection, or upstream error
 * Closure response codes: HTTP 410 (expired) or 402 (re-payment required).
 *
 * Streaming: if the server returns `Content-Type: text/event-stream`, parse
 * `data:` frames as JSON-RPC progress notifications and emit chunks via
 * `onChunk`. Otherwise we treat the response as a single JSON-RPC reply.
 */

import {
  createPublicClient,
  getAddress,
  hashTypedData,
  numberToHex,
  parseSignature,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { PACKAGE_VERSION } from "./appVersion";
import { monad, monadHttpTransport } from "./privy";
import { FORTYTWO_X402_ESCROW_MONAD } from "./usdc";

/**
 * Default endpoint: same-origin `/api/mcp` (Vercel Function proxy in `api/mcp.ts`).
 * Browsers can't call `https://mcp.fortytwo.network/mcp` directly without CORS.
 * Override with `VITE_FORTYTWO_MCP_ENDPOINT` for debugging.
 */
export const FORTYTWO_MCP_HTTP_ENDPOINT =
  (import.meta.env.VITE_FORTYTWO_MCP_ENDPOINT as string | undefined) ||
  "/api/mcp";

const TOOL_NAME = "ask_fortytwo_prime";
const SESSION_KEY_PREFIX = "fortytwo:prime:session:";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface PaymentAccept {
  /** e.g. "eip155:143" */
  network: string;
  /** Always `"exact"` for x402 v2. */
  scheme?: string;
  /** ERC-20 token contract (USDC on Monad). */
  asset: Address;
  /** Beneficiary address. */
  payTo: Address;
  /** Amount in token base units (6 decimals for USDC), as decimal string. */
  amount: string;
  /** Max validity window in seconds the server will accept. */
  maxTimeoutSeconds?: number;
  /** EIP-712 domain hints from the server (name/version may differ per chain). */
  extra?: {
    name?: string;
    version?: string;
  };
}

export interface PaymentRequired {
  x402Version?: number;
  accepts: PaymentAccept[];
}

export interface PrimeSession {
  sessionId: string;
  /** Approximate expiry timestamp (ms) — derived from server hints. */
  expiresAt: number;
  /** USDC amount that was authorized for this session (base units, decimal string). */
  authorizedAmount: string;
  /** Display-friendly amount. */
  authorizedAmountDisplay: string;
  network: string;
  /**
   * On-chain settle transaction hash returned in the `payment-response` header
   * after the server credits the escrow. Useful for support / refund flows.
   */
  paymentTxHash?: string;
  /** Timestamp (ms) when the session was opened — used to enforce the 60min hard cap. */
  openedAt?: number;
  /** ERC-20 asset signed against (USDC contract address). */
  asset?: Address;
  /** Recipient of the EIP-3009 transfer (Fortytwo escrow address). */
  payTo?: Address;
  /**
   * Last tools/call completion time (ms) — persisted so idle timeout survives
   * reload and matches server-side session rules.
   */
  lastActivityAt?: number;
}

/** Token usage for one tools/call, parsed from `_meta.usage`. */
export interface TokenUsage {
  tokensIn?: number;
  tokensOut?: number;
  /** USDC charged this call in base units (6 dp), if present in `_meta.usage`. */
  usdcChargedBaseUnits?: string;
}

/**
 * Fortytwo session hard cap (see docs/mcp-integration).
 * The 10min idle timeout is enforced locally and must match `loadSession` /
 * `PrimeApp` so we never send `x-session-id` after the server dropped the
 * session (otherwise Fortytwo can error before the payment step).
 */
const SESSION_HARD_CAP_MS = 60 * 60 * 1000;

/** Idle timeout — keep in sync with docs/mcp-integration and PrimeApp. */
export const PRIME_SESSION_IDLE_MS = 10 * 60 * 1000;

/** Human-driven progress for Fortytwo `askPrime` (optional UI). */
export type PrimeRequestPhase =
  | "initializing"
  | "calling_tool"
  | "needs_payment"
  | "wallet_payment"
  /**
   * Right after the wallet signature succeeds; brief pause before the payment
   * replay is sent. UIs often dismiss the signing modal here and show the
   * main request loader instead.
   */
  | "session_pending"
  | "confirming_payment"
  | "starting_reply"
  | "streaming";

export interface AskPrimeOptions {
  query: string;
  address: Address;
  signTypedDataAsync: (params: {
    domain: TypedDataDomain;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
  /** Optional cached session — will be reused when valid. */
  session?: PrimeSession | null;
  signal?: AbortSignal;
  /** Called with text deltas (streaming) or once with the full text. */
  onChunk?: (text: string) => void;
  /** Called when a session is created/refreshed (after a successful payment). */
  onSession?: (session: PrimeSession) => void;
  /** Called once per successful tools/call with token usage from `_meta.usage`. */
  onUsage?: (usage: TokenUsage) => void;
  /**
   * After HTTP 200 on the payment replay and `onSession` has run, but before
   * `starting_reply` / streaming the assistant body. Lets the UI show a toast
   * and defer the network loader until this promise resolves.
   */
  beforeAssistantStream?: (ctx: { session: PrimeSession }) => void | Promise<void>;
  /**
   * Called right before signing — UI can show a confirmation modal and gate
   * the actual signTypedData call. Resolve the returned promise to proceed,
   * reject (or throw) to abort.
   */
  onPaymentRequired?: (accept: PaymentAccept) => void | Promise<void>;
  /**
   * Fired as the paid `tools/call` flow advances so the UI can explain long waits.
   */
  onRequestPhase?: (phase: PrimeRequestPhase) => void;
}

export interface AskPrimeResult {
  text: string;
  session: PrimeSession | null;
  /** Token usage parsed from `_meta.usage` if present (cumulative for the call). */
  usage?: TokenUsage;
}

function wrapOnChunkWithPhase(
  onChunk: ((text: string) => void) | undefined,
  onRequestPhase: ((phase: PrimeRequestPhase) => void) | undefined
): ((text: string) => void) | undefined {
  if (!onChunk && !onRequestPhase) return undefined;
  let beforeFirstChunk = true;
  return (delta: string) => {
    if (beforeFirstChunk && delta.length > 0) {
      beforeFirstChunk = false;
      onRequestPhase?.("streaming");
    }
    onChunk?.(delta);
  };
}

/** Pause after wallet signature before replaying `tools/call` with payment. */
const POST_SIGNATURE_PAUSE_MS = 5000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
  });
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 400);
  } catch {
    return "";
  }
}

/** Readable extras from `/api/mcp` (exposes `x-upstream-status`) or raw MCP JSON errors. */
function formatMcpHttpError(res: Response, bodySlice: string): string {
  const upstream = res.headers.get("x-upstream-status");
  const bits: string[] = [];
  if (upstream) bits.push(`upstream HTTP ${upstream}`);
  const raw = bodySlice.trim().replace(/\s+/g, " ");
  if (!raw) {
    return bits.length ? ` — ${bits.join(" · ")}` : "";
  }
  if (raw.startsWith("<")) {
    bits.push("non-JSON error body");
    return bits.length ? ` — ${bits.join(" · ")}` : " — non-JSON error body";
  }
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    const msg = j?.error?.message;
    if (typeof msg === "string" && msg.length > 0) {
      bits.push(msg);
      return ` — ${bits.join(" · ")}`;
    }
  } catch {
    /* not JSON */
  }
  const short = raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
  bits.push(short);
  return ` — ${bits.join(" · ")}`;
}

// --------------------------------------------------------------------------
// JSON-RPC helpers
// --------------------------------------------------------------------------

let rpcId = 1;
function nextRpcId(): number {
  rpcId += 1;
  return rpcId;
}

function rpcCall(method: string, params: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id: nextRpcId(),
    method,
    params,
  };
}

function b64encode(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64decode(value: string): string {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function randomNonce32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/** RFC 4122 v4 UUID — used for `x-idempotency-key` (Fortytwo canonical format). */
function uuidV4(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = (i: number) => b[i].toString(16).padStart(2, "0");
  return (
    `${hx(0)}${hx(1)}${hx(2)}${hx(3)}-${hx(4)}${hx(5)}-${hx(6)}${hx(7)}` +
    `-${hx(8)}${hx(9)}-${hx(10)}${hx(11)}${hx(12)}${hx(13)}${hx(14)}${hx(15)}`
  );
}

// --------------------------------------------------------------------------
// Session cache (per-address, localStorage)
// --------------------------------------------------------------------------

export function loadSession(address: string): PrimeSession | null {
  const key = SESSION_KEY_PREFIX + address.toLowerCase();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as PrimeSession;
    if (!s.sessionId || typeof s.expiresAt !== "number") {
      localStorage.removeItem(key);
      return null;
    }
    const now = Date.now();
    if (s.expiresAt < now) {
      localStorage.removeItem(key);
      return null;
    }
    const last = s.lastActivityAt ?? s.openedAt ?? 0;
    if (last + PRIME_SESSION_IDLE_MS < now) {
      localStorage.removeItem(key);
      return null;
    }
    return s;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function saveSession(address: string, session: PrimeSession): void {
  try {
    localStorage.setItem(
      SESSION_KEY_PREFIX + address.toLowerCase(),
      JSON.stringify(session)
    );
  } catch {
    /* quota — ignore */
  }
}

export function clearSession(address: string): void {
  try {
    localStorage.removeItem(SESSION_KEY_PREFIX + address.toLowerCase());
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------------
// Free JSON-RPC calls (no payment)
// --------------------------------------------------------------------------

/**
 * MCP `initialize.params.protocolVersion` per Fortytwo integration docs.
 * @see https://docs.fortytwo.network/docs/mcp-integration
 */
export const FORTYTWO_MCP_PROTOCOL_VERSION = "2026-03-03";

/** Server-announced MCP protocol version from the last successful `initialize` (may differ from the client request). */
let negotiatedMcpProtocolVersion: string | null = null;

export function getNegotiatedMcpProtocolVersion(): string | null {
  return negotiatedMcpProtocolVersion;
}

/** Retries for `tools/call` after payment when Fortytwo returns 5xx (doc: wait and retry). */
const PAYMENT_REPLAY_MAX_ATTEMPTS = 3;
const PAYMENT_5XX_RETRY_BACKOFF_MS = 2500;

const PAYMENT_UPSTREAM_5XX_HINT =
  " USDC may still move on-chain briefly; check your Monad explorer. If funds moved or returned but the chat shows an error, contact Fortytwo support (e.g. Discord) with transaction hashes.";

const PAYMENT_EXECUTION_FAILED_HINT =
  " Cached USDC EIP-712 domain hints were cleared. Tap Retry. If no separate \"USDC ... preview\" error appeared first, your signature likely passed local checks but Fortytwo's facilitator still failed—open https://docs.fortytwo.network/docs/support-mcp or https://discord.gg/fortytwo and paste this full error plus your Request ID. Otherwise: sync your system clock, confirm Monad + the signing address, try an EOA (not a smart-contract wallet) for EIP-3009, and include any tx hashes.";

/** secp256k1 curve order `n` (EIP-2 low-`s` bound uses `n / 2`). */
const SECP256K1_N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);
const SECP256K1_HALF_N = SECP256K1_N / 2n;

/** Map ECDSA `(r,s,v)` to canonical low-`s` with matching `v` (27↔28). */
function eip2NormalizeRsV(
  r: Hex,
  s: Hex,
  v: number
): { r: Hex; s: Hex; v: number } {
  let sb = BigInt(s);
  if (sb <= SECP256K1_HALF_N) return { r, s, v };
  sb = SECP256K1_N - sb;
  const v2 = v === 27 ? 28 : v === 28 ? 27 : v;
  return { r, s: numberToHex(sb, { size: 32 }), v: v2 };
}

let mcpReady: Promise<void> | null = null;

/** One JSON-RPC `initialize` per page load before paid `tools/call` (some MCP stacks expect it). */
function ensureMcpInitialized(signal?: AbortSignal): Promise<void> {
  mcpReady ??= mcpInitialize(signal)
    .then(() => undefined)
    .catch((e) => {
      mcpReady = null;
      throw e;
    });
  return mcpReady;
}

export async function mcpInitialize(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(FORTYTWO_MCP_HTTP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      rpcCall("initialize", {
        protocolVersion: FORTYTWO_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "fortytwo-prime-chat",
          version: PACKAGE_VERSION,
        },
      })
    ),
    signal,
  });
  if (!res.ok) {
    throw new Error(`initialize failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    result?: { protocolVersion?: string };
  };
  if (json?.result?.protocolVersion) {
    negotiatedMcpProtocolVersion = json.result.protocolVersion;
  }
  return json;
}

export async function mcpListTools(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(FORTYTWO_MCP_HTTP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(rpcCall("tools/list", {})),
    signal,
  });
  if (!res.ok) {
    throw new Error(`tools/list failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --------------------------------------------------------------------------
// askPrime — orchestrated flow with x402 payment + SSE
// --------------------------------------------------------------------------

interface MakeRequestArgs {
  query: string;
  sessionId?: string | null;
  paymentSignatureB64?: string | null;
  signal?: AbortSignal;
}

async function makeToolsCallRequest(args: MakeRequestArgs): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
    // Fortytwo's spec requires `x-idempotency-key` on every `tools/call`,
    // including the initial 402-triggering call and the payment retry.
    // Format: RFC 4122 v4 UUID (matches canonical Python script).
    "x-idempotency-key": uuidV4(),
  };
  if (args.sessionId) {
    headers["x-session-id"] = args.sessionId;
  }
  if (args.paymentSignatureB64) {
    headers["payment-signature"] = args.paymentSignatureB64;
  }

  return fetch(FORTYTWO_MCP_HTTP_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(
      rpcCall("tools/call", {
        name: TOOL_NAME,
        arguments: { query: args.query },
      })
    ),
    signal: args.signal,
  });
}

interface ConsumedResponse {
  text: string;
  usage?: TokenUsage;
}

/**
 * After each streamed chunk, yield so the UI can paint. React 18 batches
 * multiple `setState` calls in the same synchronous turn; without this, SSE
 * frames parsed in one loop appear as a single jump.
 */
function yieldForStreamingUi(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Pick optional integer USDC base units from MCP usage/meta objects. */
function pickUsdcBaseUnits(
  usageRaw: Record<string, unknown>,
  meta?: Record<string, unknown>
): string | undefined {
  const keys = [
    "usdc_charged_base_units",
    "charged_base_units",
    "amount_charged_base_units",
    "usdc_base_units",
    "cost_usdc_base_units",
    "x402_charged_base_units",
    "usdc_amount",
    "charged_usdc",
  ];
  for (const obj of [usageRaw, meta]) {
    if (!obj) continue;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && /^\d+$/.test(v)) return v;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v === Math.floor(v)) {
        return String(Math.trunc(v));
      }
    }
  }
  return undefined;
}

/** Parse `_meta.usage` (Fortytwo) or `usage` (OpenAI-ish) into TokenUsage. */
function pickUsage(rpcResult: unknown): TokenUsage | undefined {
  if (!rpcResult || typeof rpcResult !== "object") return undefined;
  const r = rpcResult as Record<string, unknown>;
  const meta = (r._meta ?? r.meta) as Record<string, unknown> | undefined;
  const usageRaw = (meta?.usage ?? r.usage) as
    | Record<string, unknown>
    | undefined;
  const tokensIn =
    (usageRaw?.tokens_in as number | undefined) ??
    (usageRaw?.prompt_tokens as number | undefined) ??
    (usageRaw?.input_tokens as number | undefined);
  const tokensOut =
    (usageRaw?.tokens_out as number | undefined) ??
    (usageRaw?.completion_tokens as number | undefined) ??
    (usageRaw?.output_tokens as number | undefined);
  const usdc = pickUsdcBaseUnits(usageRaw ?? {}, meta);
  if (tokensIn == null && tokensOut == null && usdc == null) return undefined;
  return {
    tokensIn: typeof tokensIn === "number" ? tokensIn : undefined,
    tokensOut: typeof tokensOut === "number" ? tokensOut : undefined,
    usdcChargedBaseUnits: usdc,
  };
}

/**
 * Read either an SSE stream or a single JSON body, accumulate the assistant
 * text, and emit deltas via `onChunk`.
 */
async function consumeResponse(
  res: Response,
  onChunk?: (text: string) => void
): Promise<ConsumedResponse> {
  const ct = res.headers.get("content-type") || "";

  if (ct.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalText = "";
    let lastEmitted = "";
    let usage: TokenUsage | undefined;

    const pushUiChunk = async (text: string) => {
      if (!onChunk || !text) return;
      onChunk(text);
      await yieldForStreamingUi();
    };

    const emitFrom = async (rpc: any) => {
      // Notifications: progress with partial text → stream delta.
      // Final: result.content[0].text → full text.
      const params = rpc?.params;
      if (params && typeof params === "object") {
        const partial =
          typeof params.text === "string"
            ? params.text
            : typeof params.content === "string"
              ? params.content
              : typeof params.delta === "string"
                ? params.delta
                : null;
        if (partial != null) {
          if (params.text || params.content) {
            // Cumulative: emit the diff with what we already saw.
            if (partial.startsWith(lastEmitted)) {
              const delta = partial.slice(lastEmitted.length);
              if (delta) await pushUiChunk(delta);
              lastEmitted = partial;
            } else {
              await pushUiChunk(partial);
              lastEmitted = partial;
            }
          } else {
            // Pure delta.
            await pushUiChunk(partial);
            lastEmitted += partial;
          }
        }
      }
      if (rpc?.result) {
        const content = rpc.result.content;
        const text =
          Array.isArray(content) && content[0]?.type === "text"
            ? String(content[0].text ?? "")
            : typeof rpc.result.text === "string"
              ? rpc.result.text
              : "";
        if (text) {
          finalText = text;
          if (text !== lastEmitted) {
            const delta = text.startsWith(lastEmitted)
              ? text.slice(lastEmitted.length)
              : text;
            if (delta) await pushUiChunk(delta);
            lastEmitted = text;
          }
        }
        const u = pickUsage(rpc.result);
        if (u) usage = u;
      }
      if (rpc?.error) {
        throw new Error(
          rpc.error.message || `MCP error ${rpc.error.code ?? ""}`
        );
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = frame.split("\n");
        let dataPayload = "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            dataPayload += line.slice(5).trim();
          }
        }
        if (!dataPayload || dataPayload === "[DONE]") continue;
        let rpc: unknown;
        try {
          rpc = JSON.parse(dataPayload);
        } catch {
          continue;
        }
        await emitFrom(rpc);
      }
    }

    return { text: finalText || lastEmitted, usage };
  }

  // Non-streaming JSON reply.
  const json = (await res.json()) as any;
  if (json?.error) {
    throw new Error(json.error.message || `MCP error ${json.error.code ?? ""}`);
  }
  const content = json?.result?.content;
  const text =
    Array.isArray(content) && content[0]?.type === "text"
      ? String(content[0].text ?? "")
      : typeof json?.result?.text === "string"
        ? json.result.text
        : "";
  if (text && onChunk) onChunk(text);
  return { text, usage: pickUsage(json?.result) };
}

function decodePaymentRequired(res: Response): PaymentRequired | null {
  const header = res.headers.get("payment-required");
  if (!header) return null;
  try {
    const decoded = b64decode(header);
    const obj = JSON.parse(decoded) as PaymentRequired;
    if (!obj || !Array.isArray(obj.accepts)) return null;
    return obj;
  } catch {
    return null;
  }
}

function pickMonadAccept(p: PaymentRequired): PaymentAccept | null {
  return (
    p.accepts.find(
      (a) =>
        typeof a.network === "string" &&
        a.network.toLowerCase() === "eip155:143"
    ) || null
  );
}

function buildSession(
  res: Response,
  accept: PaymentAccept
): PrimeSession | null {
  const sessionId = res.headers.get("x-session-id");
  if (!sessionId) return null;
  const decimals = 6; // USDC
  const human = (Number(accept.amount) / 10 ** decimals).toString();
  // Per the integration docs, sessions are bounded by a 60min hard cap (and
  // a 10min idle timeout — re-arm on activity, not handled here). The
  // `maxTimeoutSeconds` field describes the signature window, not the session
  // lifetime, and must not be used to compute `expiresAt`.
  const openedAt = Date.now();
  const txHash = parsePaymentResponseTxHash(res);
  return {
    sessionId,
    expiresAt: openedAt + SESSION_HARD_CAP_MS,
    authorizedAmount: accept.amount,
    authorizedAmountDisplay: `${human} USDC`,
    network: accept.network,
    openedAt,
    paymentTxHash: txHash,
    asset: accept.asset,
    payTo: accept.payTo,
  };
}

/** Decode the `payment-response` header to extract the settle txHash. */
function parsePaymentResponseTxHash(res: Response): string | undefined {
  const raw = res.headers.get("payment-response");
  if (!raw) return undefined;
  try {
    const json = JSON.parse(b64decode(raw)) as Record<string, unknown>;
    const direct =
      (json.txHash as string | undefined) ??
      (json.transaction as string | undefined);
    if (typeof direct === "string") return direct;
    const payload = json.payload as Record<string, unknown> | undefined;
    if (payload) {
      const inner =
        (payload.txHash as string | undefined) ??
        (payload.transaction as string | undefined);
      if (typeof inner === "string") return inner;
    }
  } catch {
    /* not base64-JSON — ignore */
  }
  return undefined;
}

/**
 * EIP-712 domain detection.
 *
 * Different USDC deployments (and forks) use different `name`/`version`:
 * - Ethereum / Polygon / Base: name="USD Coin", version="2"
 * - Monad mainnet: name="USDC", version="2" (verified via eth_call to
 *   0x754704Bc059F8C67012fEd69BC8A327a5aafb603)
 * - Some testnets bump version to "3"
 *
 * If we sign with the wrong values, the wallet still signs (it just hashes
 * the user-provided domain) but the on-chain `receiveWithAuthorization`
 * reverts with `ExecutionFailed` because the recovered address won't match
 * the `from` field. To avoid that we probe `name()`/`version()` on the
 * actual asset contract, with a small in-memory + localStorage cache.
 * Server `payment-required` `extra` hints are not used for signing when
 * on-chain reads succeed — only as fallback when RPC fails.
 */

const ABI_NAME_VERSION = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** EIP-3009 on Circle-style USDC — same call path as `X402Escrow.settle` → USDC. */
const RECEIVE_WITH_AUTHORIZATION_ABI = [
  {
    type: "function",
    name: "receiveWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const DOMAIN_CACHE_KEY = "fortytwo:eip712-domain:";

interface ResolvedDomain {
  name: string;
  version: string;
}

const memDomainCache = new Map<string, ResolvedDomain>();

/** Drop cached EIP-712 domain so the next payment re-probes `name()` / `version()` on-chain. */
function invalidateEip712DomainCache(asset: Address): void {
  const key = asset.toLowerCase();
  memDomainCache.delete(key);
  try {
    localStorage.removeItem(DOMAIN_CACHE_KEY + key);
  } catch {
    /* private mode / quota */
  }
}

async function resolveDomainHints(
  asset: Address,
  fallback: { name: string; version: string }
): Promise<ResolvedDomain> {
  const key = asset.toLowerCase();

  const memHit = memDomainCache.get(key);
  if (memHit) return memHit;

  try {
    const cached = localStorage.getItem(DOMAIN_CACHE_KEY + key);
    if (cached) {
      const parsed = JSON.parse(cached) as ResolvedDomain;
      if (parsed?.name && parsed?.version) {
        memDomainCache.set(key, parsed);
        return parsed;
      }
    }
  } catch {
    /* ignore corrupted cache */
  }

  try {
    const client = createPublicClient({
      chain: monad,
      transport: monadHttpTransport,
    });
    const [name, version] = await Promise.all([
      client.readContract({
        address: asset,
        abi: ABI_NAME_VERSION,
        functionName: "name",
      }),
      client.readContract({
        address: asset,
        abi: ABI_NAME_VERSION,
        functionName: "version",
      }),
    ]);
    const resolved: ResolvedDomain = {
      name: String(name),
      version: String(version),
    };
    memDomainCache.set(key, resolved);
    try {
      localStorage.setItem(DOMAIN_CACHE_KEY + key, JSON.stringify(resolved));
    } catch {
      /* quota — best-effort */
    }
    return resolved;
  } catch {
    // RPC unreachable (or asset on a different chain than Monad) — caller
    // should still get a sensible default.
    return fallback;
  }
}

/**
 * Fortytwo's `x402Escrow` is built on EIP-3009 *`receiveWithAuthorization`*
 * (NOT `transferWithAuthorization`): only the escrow contract can pull the
 * funds, which makes the authorization MEV-resistant. The struct fields are
 * identical to `TransferWithAuthorization` but the type name differs, which
 * changes the EIP-712 typeHash and therefore the digest the user signs.
 *
 * Refs:
 * - github.com/Fortytwo-Network/fortytwo-x402Escrow (README)
 * - platform.fortytwo.network/x402escrow ("EIP-3009 receiveWithAuthorization
 *   (not transfer)")
 * - EIP-3009 spec ("ReceiveWithAuthorization" primaryType)
 */
const EIP3009_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function buildPaymentSignature(
  accept: PaymentAccept,
  address: Address,
  signTypedDataAsync: AskPrimeOptions["signTypedDataAsync"]
): Promise<string> {
  const fromAddr = getAddress(address);
  const chainClient = createPublicClient({
    chain: monad,
    transport: monadHttpTransport,
  });
  const [latestBlock, fromBytecode] = await Promise.all([
    chainClient.getBlock({ blockTag: "latest" }).catch(() => null),
    chainClient.getCode({ address: fromAddr }).catch(() => undefined),
  ]);
  // USDC checks `block.timestamp` against validAfter/validBefore — not the
  // wall clock. A skewed OS clock makes authorizations "expired" on-chain.
  const now = latestBlock
    ? Number(latestBlock.timestamp)
    : Math.floor(Date.now() / 1000);
  // Stay within the server-advertised window if any (defaults to 90s).
  const window = Math.max(30, (accept.maxTimeoutSeconds ?? 90) - 5);
  const validBefore = now + window;
  const nonce = randomNonce32();

  const toAddr = getAddress(accept.payTo);
  const assetAddr = getAddress(accept.asset);
  if (accept.network.toLowerCase() === "eip155:143") {
    const expectedEscrow = getAddress(FORTYTWO_X402_ESCROW_MONAD);
    if (toAddr !== expectedEscrow) {
      throw new Error(
        `Fortytwo payment route lists payTo ${toAddr} on Monad, but this app only supports x402Escrow at ${expectedEscrow}.`
      );
    }
  }

  const need = BigInt(accept.amount);
  const [resolved, balanceRaw] = await Promise.all([
    resolveDomainHints(assetAddr, {
      name: accept.extra?.name ?? "USDC",
      version: accept.extra?.version ?? "2",
    }),
    chainClient
      .readContract({
        address: assetAddr,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [fromAddr],
      })
      .catch(() => null),
  ]);
  if (balanceRaw !== null && (balanceRaw as bigint) < need) {
    throw new Error(
      `Insufficient USDC on Monad for this payment: your balance is ${(balanceRaw as bigint).toString()} but at least ${need.toString()} (base units, 6 decimals) is required.`
    );
  }

  // EIP-712 domain must match the token contract's `name()` / `version()` or
  // `receiveWithAuthorization` reverts. On-chain reads are authoritative; do
  // not prefer `accepts[].extra` over them (stale or cross-chain hints cause
  // persistent ExecutionFailed). `extra` is only used as fallback when RPC
  // fails — see `resolveDomainHints` second argument.
  const domain: TypedDataDomain = {
    name: resolved.name,
    version: resolved.version,
    chainId: monad.id,
    verifyingContract: assetAddr,
  };

  const message = {
    from: fromAddr,
    to: toAddr,
    value: need,
    validAfter: 0n,
    validBefore: BigInt(validBefore),
    nonce,
  };

  // Strip the `readonly` markers added by `as const` for the EIP-712 schema.
  const receiveType = EIP3009_TYPES.ReceiveWithAuthorization.map((f) => ({
    name: f.name,
    type: f.type,
  }));
  const fullTypes: Record<string, { name: string; type: string }[]> = {
    EIP712Domain: EIP3009_TYPES.EIP712Domain.map((f) => ({
      name: f.name,
      type: f.type,
    })),
    ReceiveWithAuthorization: receiveType,
  };

  let signature: Hex;
  try {
    signature = await signTypedDataAsync({
      domain,
      types: { ReceiveWithAuthorization: receiveType },
      primaryType: "ReceiveWithAuthorization",
      message: message as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Some wallets need EIP712Domain explicitly listed in types.
    signature = await signTypedDataAsync({
      domain,
      types: fullTypes,
      primaryType: "ReceiveWithAuthorization",
      message: message as unknown as Record<string, unknown>,
    });
    void err;
  }

  const isEoa = fromBytecode === "0x";
  if (isEoa) {
    const recovered = await recoverTypedDataAddress({
      domain,
      types: { ReceiveWithAuthorization: receiveType },
      primaryType: "ReceiveWithAuthorization",
      message,
      signature,
    });
    if (recovered.toLowerCase() !== fromAddr.toLowerCase()) {
      throw new Error(
        "Payment signature does not recover to your connected address. Check that your wallet is on Monad, your system clock is accurate, and try again."
      );
    }
  }

  // Sanity: ensure the digest is recoverable (helps debugging signature issues).
  void hashTypedData({
    domain,
    types: { ReceiveWithAuthorization: receiveType },
    primaryType: "ReceiveWithAuthorization",
    message,
  });

  // Fortytwo's facilitator uses an x402-v2 *escrow* extension whose wire
  // payload differs from the canonical Coinbase shape: it expects
  // `{client, maxAmount, validAfter, validBefore, nonce, v, r, s}` flattened
  // under `payload`, then reconstructs the EIP-3009 `ReceiveWithAuthorization`
  // struct and calls `escrow.settle(...)` (which forwards to USDC's
  // `receiveWithAuthorization`). The struct typeHash MUST be Receive, not
  // Transfer — that part is enforced via `primaryType` above. The 27/28
  // recovery byte is required (some EIP-1271 wallets use 0/1, but EOAs use
  // 27/28).
  const split = parseSignature(signature);
  const vRaw = Number(split.v ?? (split.yParity === 1 ? 28 : 27));
  const { r: rNorm, s: sNorm, v: vNorm } = eip2NormalizeRsV(
    split.r,
    split.s,
    vRaw
  );

  try {
    await chainClient.simulateContract({
      address: assetAddr,
      abi: RECEIVE_WITH_AUTHORIZATION_ABI,
      functionName: "receiveWithAuthorization",
      args: [
        fromAddr,
        toAddr,
        need,
        0n,
        BigInt(validBefore),
        nonce,
        vNorm,
        rNorm,
        sNorm,
      ],
      account: toAddr,
    });
  } catch (err: unknown) {
    const details =
      err && typeof err === "object" && "shortMessage" in err
        ? String((err as { shortMessage?: string }).shortMessage)
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(
      `USDC receiveWithAuthorization failed on-chain preview (Monad): ${details}`
    );
  }

  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: accept.network,
    payload: {
      client: fromAddr,
      maxAmount: need.toString(),
      validAfter: "0",
      validBefore: validBefore.toString(),
      nonce,
      v: vNorm,
      r: rNorm,
      s: sNorm,
    },
  };

  return b64encode(payload);
}

export async function askPrime(opts: AskPrimeOptions): Promise<AskPrimeResult> {
  const {
    query,
    address,
    signTypedDataAsync,
    session,
    signal,
    onChunk,
    onSession,
    onUsage,
    onPaymentRequired,
    onRequestPhase,
    beforeAssistantStream,
  } = opts;

  let currentSession = session ?? null;

  onRequestPhase?.("initializing");
  await ensureMcpInitialized(signal);

  // Up to 2 attempts: e.g. cached session rejected → retry without x-session-id.
  for (let attempt = 0; attempt < 2; attempt++) {
    onRequestPhase?.("calling_tool");
    const res = await makeToolsCallRequest({
      query,
      sessionId: currentSession?.sessionId,
      signal,
    });

    if (res.ok) {
      onRequestPhase?.("starting_reply");
      const wrapped = wrapOnChunkWithPhase(onChunk, onRequestPhase);
      const consumed = await consumeResponse(res, wrapped);
      // Refresh session id if the server rotated it.
      const sid = res.headers.get("x-session-id");
      if (sid && currentSession && sid !== currentSession.sessionId) {
        currentSession = { ...currentSession, sessionId: sid };
        if (onSession) onSession(currentSession);
      }
      if (consumed.usage && onUsage) onUsage(consumed.usage);
      return { text: consumed.text, session: currentSession, usage: consumed.usage };
    }

    async function dropSessionAndRetry(): Promise<void> {
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      currentSession = null;
      clearSession(address);
    }

    // Session expired / unknown (Fortytwo uses 410 or 404 "session not found").
    if ((res.status === 410 || res.status === 404) && currentSession) {
      await dropSessionAndRetry();
      continue;
    }

    // Some deployments return 500 for bad session state; retry once without it.
    if (res.status === 500 && currentSession) {
      await dropSessionAndRetry();
      continue;
    }

    if (res.status === 402) {
      let required = decodePaymentRequired(res);
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        /* ignore */
      }
      if (!required && bodyText) {
        try {
          const obj = JSON.parse(bodyText) as PaymentRequired;
          if (obj && Array.isArray(obj.accepts)) required = obj;
        } catch {
          /* not JSON */
        }
      }
      if (!required) {
        throw new Error(
          "Payment required but server didn't send a payment-required header or JSON accepts"
        );
      }
      const accept = pickMonadAccept(required);
      if (!accept) {
        throw new Error(
          "No accepted payment route for Monad (eip155:143). Check your network or try later."
        );
      }
      onRequestPhase?.("needs_payment");
      if (onPaymentRequired) {
        await onPaymentRequired(accept);
      }

      onRequestPhase?.("wallet_payment");
      const signatureB64 = await buildPaymentSignature(
        accept,
        address,
        signTypedDataAsync
      );

      onRequestPhase?.("session_pending");
      await sleep(POST_SIGNATURE_PAUSE_MS, signal);

      onRequestPhase?.("confirming_payment");
      let replay: Response | null = null;
      let lastPaymentReplayDetail = "";
      for (let payAttempt = 0; payAttempt < PAYMENT_REPLAY_MAX_ATTEMPTS; payAttempt++) {
        if (payAttempt > 0) {
          await sleep(PAYMENT_5XX_RETRY_BACKOFF_MS * payAttempt, signal);
        }
        replay = await makeToolsCallRequest({
          query,
          paymentSignatureB64: signatureB64,
          signal,
        });
        if (replay.ok) break;
        const txt = await safeReadText(replay);
        lastPaymentReplayDetail = formatMcpHttpError(replay, txt);
        const retryable =
          replay.status >= 500 &&
          replay.status < 600 &&
          payAttempt < PAYMENT_REPLAY_MAX_ATTEMPTS - 1;
        if (retryable) continue;
        if (replay.status >= 500) {
          throw new Error(
            `Fortytwo MCP returned ${replay.status} ${replay.statusText} after signing (server or network issue, not your wallet declining)${lastPaymentReplayDetail}${PAYMENT_UPSTREAM_5XX_HINT}`
          );
        }
        const executionFailed = /executionfailed/i.test(
          lastPaymentReplayDetail
        );
        if (replay.status === 400 && executionFailed) {
          invalidateEip712DomainCache(accept.asset);
          throw new Error(
            `Fortytwo did not complete payment (${replay.status} ${replay.statusText})${lastPaymentReplayDetail}${PAYMENT_EXECUTION_FAILED_HINT}`
          );
        }
        throw new Error(
          `Fortytwo did not complete payment (${replay.status} ${replay.statusText})${lastPaymentReplayDetail}`
        );
      }

      if (!replay?.ok) {
        throw new Error("askPrime: payment replay failed unexpectedly");
      }

      const built = buildSession(replay, accept);
      if (!built) {
        throw new Error(
          "Fortytwo accepted payment but did not return x-session-id. Try again."
        );
      }
      currentSession = built;
      if (onSession) onSession(built);

      if (beforeAssistantStream) {
        await beforeAssistantStream({ session: built });
      }

      onRequestPhase?.("starting_reply");
      const wrappedReplay = wrapOnChunkWithPhase(onChunk, onRequestPhase);
      const consumed = await consumeResponse(replay, wrappedReplay);
      const sid = replay.headers.get("x-session-id");
      if (
        sid &&
        currentSession &&
        sid !== currentSession.sessionId
      ) {
        currentSession = { ...currentSession, sessionId: sid };
        if (onSession) onSession(currentSession);
      }
      if (consumed.usage && onUsage) onUsage(consumed.usage);
      return {
        text: consumed.text,
        session: currentSession,
        usage: consumed.usage,
      };
    }

    // Other errors → bail out.
    const txt = await safeReadText(res);
    const detail = formatMcpHttpError(res, txt);
    throw new Error(`Fortytwo error ${res.status} ${res.statusText}${detail}`);
  }

  throw new Error("askPrime: exhausted attempts");
}
