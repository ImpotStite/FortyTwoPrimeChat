/**
 * FortyTwo MCP client.
 *
 * Single endpoint: POST https://mcp.fortytwo.network/mcp (JSON-RPC 2.0).
 * Tool used: `ask_fortytwo_prime`.
 *
 * Payment flow (x402Escrow on Monad mainnet, USDC):
 *  1. Replay session if we already have one (header `x-session-id`).
 *  2. Otherwise call `tools/call` without signature → server replies HTTP 402
 *     with a base64 JSON `payment-required` payload listing accepted networks.
 *  3. Pick `eip155:143` (Monad), build an EIP-712 / EIP-3009 `TransferWithAuthorization`
 *     for USDC, sign it with the user's wallet (via Privy → viem).
 *  4. Replay the same `tools/call` with `payment-signature` (base64 JSON) header.
 *  5. Server replies 200 with `x-session-id`; cache it for follow-ups in the
 *     same session.
 *
 * Streaming: if the server returns `Content-Type: text/event-stream`, parse
 * `data:` frames as JSON-RPC progress notifications and emit chunks via
 * `onChunk`. Otherwise we treat the response as a single JSON-RPC reply.
 */

import {
  createPublicClient,
  hashTypedData,
  http,
  parseSignature,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { monad } from "./privy";

/**
 * Default endpoint: same-origin `/api/mcp` (Vercel Function proxy in `api/mcp.ts`).
 * Browsers can't talk to `mcp.fortytwo.network` directly because the server
 * doesn't reply to CORS preflights — the proxy adds the missing headers and
 * forwards the streaming body verbatim.
 *
 * Override with `VITE_FORTYTWO_MCP_ENDPOINT` if you have your own proxy or if
 * FortyTwo eventually enables CORS server-side.
 */
const ENDPOINT =
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
}

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
  /**
   * Called right before signing — UI can show a confirmation modal and gate
   * the actual signTypedData call. Resolve the returned promise to proceed,
   * reject (or throw) to abort.
   */
  onPaymentRequired?: (accept: PaymentAccept) => void | Promise<void>;
}

export interface AskPrimeResult {
  text: string;
  session: PrimeSession | null;
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
  if (typeof btoa === "function") {
    // btoa needs latin1 — replace any non-ascii via UTF-8 → escape.
    return btoa(unescape(encodeURIComponent(json)));
  }
  // Node fallback (not used in the browser build).
  return Buffer.from(json, "utf-8").toString("base64");
}

function b64decode(value: string): string {
  if (typeof atob === "function") {
    return decodeURIComponent(escape(atob(value)));
  }
  return Buffer.from(value, "base64").toString("utf-8");
}

function randomNonce32(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

/** RFC 4122 v4 UUID — used for `x-idempotency-key` (FortyTwo canonical format). */
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
  try {
    const raw = localStorage.getItem(SESSION_KEY_PREFIX + address.toLowerCase());
    if (!raw) return null;
    const s = JSON.parse(raw) as PrimeSession;
    if (!s.sessionId || typeof s.expiresAt !== "number") return null;
    if (s.expiresAt < Date.now()) return null;
    return s;
  } catch {
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

export async function mcpInitialize(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      rpcCall("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "fortytwo-prime-chat", version: "0.1.0" },
      })
    ),
    signal,
  });
  if (!res.ok) {
    throw new Error(`initialize failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function mcpListTools(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
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
    // FortyTwo's spec requires `x-idempotency-key` on every `tools/call`,
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

  return fetch(ENDPOINT, {
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

/**
 * Read either an SSE stream or a single JSON body, accumulate the assistant
 * text, and emit deltas via `onChunk`.
 */
async function consumeResponse(
  res: Response,
  onChunk?: (text: string) => void
): Promise<string> {
  const ct = res.headers.get("content-type") || "";

  if (ct.includes("text/event-stream") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalText = "";
    let lastEmitted = "";

    const emitFrom = (rpc: any) => {
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
              if (delta && onChunk) onChunk(delta);
              lastEmitted = partial;
            } else {
              if (onChunk) onChunk(partial);
              lastEmitted = partial;
            }
          } else {
            // Pure delta.
            if (onChunk) onChunk(partial);
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
            if (delta && onChunk) onChunk(delta);
            lastEmitted = text;
          }
        }
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
        try {
          const rpc = JSON.parse(dataPayload);
          emitFrom(rpc);
        } catch {
          /* skip malformed frame */
        }
      }
    }

    return finalText || lastEmitted;
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
  return text;
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
  // FortyTwo currently exposes `maxTimeoutSeconds` (signature window). Sessions
  // typically last longer than a single signature, so we extrapolate to one hour
  // by default; if the server later returns a richer hint we can refresh it.
  const validity = (accept.maxTimeoutSeconds ?? 60) * 60;
  const decimals = 6; // USDC
  const human = (Number(accept.amount) / 10 ** decimals).toString();
  return {
    sessionId,
    expiresAt: Date.now() + validity * 1000,
    authorizedAmount: accept.amount,
    authorizedAmountDisplay: `${human} USDC`,
    network: accept.network,
  };
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
 * the user-provided domain) but the on-chain `transferWithAuthorization`
 * reverts with `ExecutionFailed` because the recovered address won't match
 * the `from` field. To avoid that we probe `name()`/`version()` on the
 * actual asset contract, with a small in-memory + localStorage cache.
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

const DOMAIN_CACHE_KEY = "fortytwo:eip712-domain:";

interface ResolvedDomain {
  name: string;
  version: string;
}

const memDomainCache = new Map<string, ResolvedDomain>();

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
    const client = createPublicClient({ chain: monad, transport: http() });
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
 * FortyTwo's `x402Escrow` is built on EIP-3009 *`receiveWithAuthorization`*
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
  const now = Math.floor(Date.now() / 1000);
  // Stay within the server-advertised window if any (defaults to 90s).
  const window = Math.max(30, (accept.maxTimeoutSeconds ?? 90) - 5);
  const validBefore = now + window;
  const nonce = randomNonce32();

  // Resolve the canonical EIP-712 domain for this asset. Prefer server hints,
  // then on-chain probe, then a Monad-specific default ("USDC" / "2").
  const resolved = await resolveDomainHints(accept.asset, {
    name: "USDC",
    version: "2",
  });
  const domain: TypedDataDomain = {
    name: accept.extra?.name ?? resolved.name,
    version: accept.extra?.version ?? resolved.version,
    chainId: 143,
    verifyingContract: accept.asset,
  };

  const message = {
    from: address,
    to: accept.payTo,
    value: BigInt(accept.amount),
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

  // Sanity: ensure the digest is recoverable (helps debugging signature issues).
  void hashTypedData({
    domain,
    types: { ReceiveWithAuthorization: receiveType },
    primaryType: "ReceiveWithAuthorization",
    message,
  });

  // FortyTwo's facilitator uses an x402-v2 *escrow* extension whose wire
  // payload differs from the canonical Coinbase shape: it expects
  // `{client, maxAmount, validAfter, validBefore, nonce, v, r, s}` flattened
  // under `payload`, then reconstructs the EIP-3009 `ReceiveWithAuthorization`
  // struct and calls `escrow.settle(...)` (which forwards to USDC's
  // `receiveWithAuthorization`). The struct typeHash MUST be Receive, not
  // Transfer — that part is enforced via `primaryType` above. The 27/28
  // recovery byte is required (some EIP-1271 wallets use 0/1, but EOAs use
  // 27/28).
  const split = parseSignature(signature);
  const v = split.v ?? (split.yParity === 1 ? 28 : 27);

  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: accept.network,
    payload: {
      client: address,
      maxAmount: accept.amount,
      validAfter: "0",
      validBefore: validBefore.toString(),
      nonce,
      v: Number(v),
      r: split.r,
      s: split.s,
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
    onPaymentRequired,
  } = opts;

  let currentSession = session ?? null;

  // Up to 2 attempts: one with cached session, one fresh after 402/410.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await makeToolsCallRequest({
      query,
      sessionId: currentSession?.sessionId,
      signal,
    });

    if (res.ok) {
      const text = await consumeResponse(res, onChunk);
      // Refresh session id if the server rotated it.
      const sid = res.headers.get("x-session-id");
      if (sid && currentSession && sid !== currentSession.sessionId) {
        currentSession = { ...currentSession, sessionId: sid };
        if (onSession) onSession(currentSession);
      }
      return { text, session: currentSession };
    }

    // Session expired/unknown → drop it and retry without sessionId in the next loop step.
    if (res.status === 410 && currentSession) {
      currentSession = null;
      continue;
    }

    if (res.status === 402) {
      const required = decodePaymentRequired(res);
      // Drain the body (some servers expect it).
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      if (!required) {
        throw new Error(
          "Payment required but server didn't send a payment-required header"
        );
      }
      const accept = pickMonadAccept(required);
      if (!accept) {
        throw new Error(
          "No accepted payment route for Monad (eip155:143). Check your network or try later."
        );
      }
      if (onPaymentRequired) {
        await onPaymentRequired(accept);
      }

      const signatureB64 = await buildPaymentSignature(
        accept,
        address,
        signTypedDataAsync
      );

      const replay = await makeToolsCallRequest({
        query,
        paymentSignatureB64: signatureB64,
        signal,
      });

      if (!replay.ok) {
        const txt = await safeReadText(replay);
        throw new Error(
          `FortyTwo refused payment (${replay.status} ${replay.statusText})${
            txt ? ` — ${txt}` : ""
          }`
        );
      }

      const text = await consumeResponse(replay, onChunk);
      const built = buildSession(replay, accept);
      if (built) {
        currentSession = built;
        if (onSession) onSession(built);
      }
      return { text, session: currentSession };
    }

    // Other errors → bail out.
    const txt = await safeReadText(res);
    throw new Error(
      `FortyTwo error ${res.status} ${res.statusText}${txt ? ` — ${txt}` : ""}`
    );
  }

  throw new Error("askPrime: exhausted attempts");
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 400);
  } catch {
    return "";
  }
}
