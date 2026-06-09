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
 * Session lifetime (per docs.fortytwo.network/docs/mcp-integration):
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
  hashTypedData,
  parseSignature,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { computeEscrowIdVerified } from "./escrowRefund";
import { monad, monadHttpTransport } from "./privy";

const ENDPOINT =
  (import.meta.env.VITE_FORTYTWO_MCP_ENDPOINT as string | undefined) ||
  "/api/mcp";

const TOOL_NAME = "ask_fortytwo_prime";
const SESSION_KEY_PREFIX = "fortytwo:prime:session:";
const MCP_TOOLS_CACHE_KEY = "fortytwo:prime:mcp-tools";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface StoredPaymentAuth {
  network: string;
  client: Address;
  nonce: Hex;
  maxAmount: string;
  validAfter: string;
  validBefore: string;
}

export interface PaymentSignatureBundle {
  signatureB64: string;
  auth: StoredPaymentAuth;
  escrowId: Hex;
}


export interface PaymentAccept {
  network: string;
  scheme?: string;
  asset: Address;
  payTo: Address;
  amount: string;
  maxTimeoutSeconds?: number;
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
  expiresAt: number;
  authorizedAmount: string;
  authorizedAmountDisplay: string;
  network: string;
  paymentTxHash?: string;
  openedAt?: number;
  asset?: Address;
  payTo?: Address;
  lastActivityAt?: number;
  paymentResponseB64?: string;
  paymentResponseTxHash?: string;
  paymentAuth?: StoredPaymentAuth;
  paymentSignatureB64?: string;
  escrowId?: Hex;
}

export interface TokenUsage {
  tokensIn?: number;
  tokensOut?: number;
  usdcChargedBaseUnits?: string;
}

/**
 * Fortytwo session hard cap (see docs/mcp-integration).
 * The 10min idle timeout is enforced locally and must match `loadSession` /
 * `PrimeApp` so we never send `x-session-id` after the server dropped the
 * session (otherwise Fortytwo can error before the payment step).
 */
const SESSION_HARD_CAP_MS = 60 * 60 * 1000;

export const PRIME_SESSION_IDLE_MS = 10 * 60 * 1000;

export type PrimeRequestPhase =
  | "initializing"
  | "calling_tool"
  | "needs_payment"
  | "wallet_payment"
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
  session?: PrimeSession | null;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onSession?: (session: PrimeSession) => void;
  onUsage?: (usage: TokenUsage) => void;
  beforeAssistantStream?: (ctx: { session: PrimeSession }) => void | Promise<void>;
  onPaymentRequired?: (accept: PaymentAccept) => void | Promise<void>;
  onRequestPhase?: (phase: PrimeRequestPhase) => void;
}

export interface AskPrimeResult {
  text: string;
  session: PrimeSession | null;
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

/** RFC 4122 v4 UUID, used for `x-idempotency-key` (Fortytwo canonical format). */
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
  }
}

export function clearSession(address: string): void {
  try {
    localStorage.removeItem(SESSION_KEY_PREFIX + address.toLowerCase());
  } catch {
  }
}


const MCP_PROTOCOL_VERSION = "2025-11-25";

let mcpReady: Promise<void> | null = null;

let cachedMcpTools: McpToolDescriptor[] | null = null;

export function getCachedMcpTools(): readonly McpToolDescriptor[] {
  return cachedMcpTools ?? [];
}

function persistMcpToolsCache(tools: McpToolDescriptor[]): void {
  cachedMcpTools = tools;
  try {
    localStorage.setItem(MCP_TOOLS_CACHE_KEY, JSON.stringify(tools));
  } catch {
  }
}

export function loadPersistedMcpTools(): McpToolDescriptor[] {
  try {
    const raw = localStorage.getItem(MCP_TOOLS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is McpToolDescriptor =>
        !!t && typeof (t as McpToolDescriptor).name === "string"
    );
  } catch {
    return [];
  }
}

export async function listMcpTools(
  signal?: AbortSignal
): Promise<McpToolDescriptor[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(rpcCall("tools/list", {})),
    signal,
  });
  if (!res.ok) {
    throw new Error(`tools/list failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    result?: { tools?: unknown[] };
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message || "tools/list MCP error");
  }
  const raw = json.result?.tools;
  if (!Array.isArray(raw)) return [];
  const tools: McpToolDescriptor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = row.name;
    if (typeof name !== "string" || !name) continue;
    tools.push({
      name,
      description:
        typeof row.description === "string" ? row.description : undefined,
      inputSchema:
        row.inputSchema && typeof row.inputSchema === "object"
          ? (row.inputSchema as Record<string, unknown>)
          : undefined,
    });
  }
  persistMcpToolsCache(tools);
  return tools;
}

function ensureMcpInitialized(signal?: AbortSignal): Promise<void> {
  mcpReady ??= (async () => {
    await mcpInitialize(signal);
    const tools = await listMcpTools(signal);
    persistMcpToolsCache(tools);
  })().catch((e) => {
    mcpReady = null;
    throw e;
  });
  return mcpReady;
}

async function mcpInitialize(signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      rpcCall("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
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
            if (partial.startsWith(lastEmitted)) {
              const delta = partial.slice(lastEmitted.length);
              if (delta) await pushUiChunk(delta);
              lastEmitted = partial;
            } else {
              await pushUiChunk(partial);
              lastEmitted = partial;
            }
          } else {
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
  accept: PaymentAccept,
  payment?: PaymentSignatureBundle
): PrimeSession | null {
  const sessionId = res.headers.get("x-session-id");
  if (!sessionId) return null;
  const decimals = 6; // USDC
  const human = (Number(accept.amount) / 10 ** decimals).toString();
  // Per the integration docs, sessions are bounded by a 60min hard cap (and
  // a 10min idle timeout, re-arm on activity, not handled here). The
  // `maxTimeoutSeconds` field describes the signature window, not the session
  // lifetime, and must not be used to compute `expiresAt`.
  const openedAt = Date.now();
  const paymentResponseB64 = res.headers.get("payment-response") ?? undefined;
  const txHash = parsePaymentResponseTxHash(res);
  return {
    sessionId,
    expiresAt: openedAt + SESSION_HARD_CAP_MS,
    authorizedAmount: accept.amount,
    authorizedAmountDisplay: `${human} USDC`,
    network: accept.network,
    openedAt,
    paymentTxHash: txHash,
    paymentResponseB64,
    paymentResponseTxHash: txHash,
    paymentAuth: payment?.auth,
    paymentSignatureB64: payment?.signatureB64,
    escrowId: payment?.escrowId,
    asset: accept.asset,
    payTo: accept.payTo,
  };
}

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
    }
    return resolved;
  } catch {
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
): Promise<PaymentSignatureBundle> {
  const now = Math.floor(Date.now() / 1000);
  const window = Math.max(30, (accept.maxTimeoutSeconds ?? 90) - 5);
  const validBefore = now + window;
  const nonce = randomNonce32();

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
  // Transfer, that part is enforced via `primaryType` above. The 27/28
  // recovery byte is required (some EIP-1271 wallets use 0/1, but EOAs use
  // 27/28).
  const split = parseSignature(signature);
  const v = split.v ?? (split.yParity === 1 ? 28 : 27);

  const auth: StoredPaymentAuth = {
    network: accept.network,
    client: address,
    nonce,
    maxAmount: accept.amount,
    validAfter: "0",
    validBefore: validBefore.toString(),
  };

  const escrowId = computeEscrowIdVerified(address, nonce);

  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: accept.network,
    payload: {
      client: address,
      maxAmount: accept.amount,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce,
      v: Number(v),
      r: split.r,
      s: split.s,
    },
  };

  return {
    signatureB64: b64encode(payload),
    auth,
    escrowId,
  };
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
      }
      currentSession = null;
      clearSession(address);
    }

    if ((res.status === 410 || res.status === 404) && currentSession) {
      await dropSessionAndRetry();
      continue;
    }

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
      }
      if (!required && bodyText) {
        try {
          const obj = JSON.parse(bodyText) as PaymentRequired;
          if (obj && Array.isArray(obj.accepts)) required = obj;
        } catch {
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
      const paymentBundle = await buildPaymentSignature(
        accept,
        address,
        signTypedDataAsync
      );

      onRequestPhase?.("session_pending");
      await sleep(POST_SIGNATURE_PAUSE_MS, signal);

      onRequestPhase?.("confirming_payment");
      const replay = await makeToolsCallRequest({
        query,
        paymentSignatureB64: paymentBundle.signatureB64,
        signal,
      });

      if (!replay.ok) {
        const txt = await safeReadText(replay);
        throw new Error(
          `Fortytwo refused payment (${replay.status} ${replay.statusText})${
            txt ? `, ${txt}` : ""
          }`
        );
      }

      const built = buildSession(replay, accept, paymentBundle);
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

    const txt = await safeReadText(res);
    throw new Error(
      `Fortytwo error ${res.status} ${res.statusText}${txt ? `, ${txt}` : ""}`
    );
  }

  throw new Error("askPrime: exhausted attempts");
}
