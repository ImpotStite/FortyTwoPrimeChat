/**
 * Per-wallet history of Fortytwo Prime billing sessions.
 *
 * A record is appended when a session opens (settle TX confirmed) and
 * patched on closure (idle / hard cap / 410 / refund detected via on-chain
 * Transfer event). The list is the source of truth for the "Past sessions"
 * UI and any cost analytics we surface.
 */

import { FORTYTWO_X402_ESCROW_MONAD } from "./usdc";

const KEY_PREFIX = "fortytwo-prime-chat:prime-history:";

/** Why a session ended — drives badge colors and tooltips in the UI. */
export type CloseReason =
  | "idle" // 10min without activity
  | "hard-cap" // 60min from open
  | "402" // server requested re-payment
  | "410" // server reports session gone
  | "manual" // user disconnected wallet / cleared session
  | "error"; // unrecoverable error during streaming

export interface PrimeSessionRecord {
  /** sessionId returned by the server (header `x-session-id`). */
  id: string;
  /** Owner wallet address (lowercase) — also used as the storage key bucket. */
  walletAddress: string;
  /** Network identifier (e.g. "eip155:143"). */
  network: string;
  /** Chain ID number derived from network ("eip155:N" → N). */
  chainId?: number;
  /** Authorized USDC amount (token base units, decimal string). */
  authorizedAmount: string;
  /** Display-friendly authorized amount (e.g. "2 USDC"). */
  authorizedAmountDisplay: string;
  /** Asset contract address signed against (USDC on Monad). */
  asset?: string;
  /** Escrow recipient (`payTo` from the 402 challenge). */
  payTo?: string;

  /** Timestamps (ms since epoch). */
  openedAt: number;
  closedAt?: number;
  closeReason?: CloseReason;

  /** On-chain settle transaction (USDC leaves wallet). */
  settleTxHash?: string;
  /** On-chain refund transaction (unused USDC returns). */
  refundTxHash?: string;
  /** Refunded amount in base units (decimal string). */
  refundedAmount?: string;
  /** Effective spent amount (authorized - refunded), base units. */
  spentAmount?: string;

  /** Tally of `tools/call` requests that hit the server during this session. */
  messageCount: number;
  /** Cumulative input tokens reported by the server (`_meta.usage.tokens_in`). */
  tokensIn?: number;
  /** Cumulative output tokens reported by the server. */
  tokensOut?: number;
  /**
   * Sum of optional per-call USDC charges reported in `_meta.usage` (6 decimals,
   * base units). Not always present — on-chain spent/refund remain authoritative.
   */
  apiReportedSpentBaseUnits?: string;
}

/** Maximum entries kept per wallet — older sessions are pruned on append. */
const MAX_ENTRIES = 100;

function key(addr: string): string {
  return KEY_PREFIX + addr.toLowerCase();
}

function chainIdFromNetwork(network: string | undefined): number | undefined {
  if (!network) return undefined;
  const m = /eip155:(\d+)/i.exec(network);
  return m ? Number(m[1]) : undefined;
}

/** Resolved chain id for a stored session row (explicit or parsed from `network`). */
export function primeSessionChainId(
  r: PrimeSessionRecord
): number | undefined {
  return r.chainId ?? chainIdFromNetwork(r.network);
}

/**
 * Escrow `payTo` from the 402 challenge, or the known Monad x402Escrow address
 * for legacy rows missing `payTo` (chainId 143).
 */
export function effectivePayTo(r: PrimeSessionRecord): string | undefined {
  if (r.payTo) return r.payTo;
  const cid = r.chainId ?? chainIdFromNetwork(r.network);
  if (cid === 143) {
    return FORTYTWO_X402_ESCROW_MONAD.toLowerCase();
  }
  return undefined;
}

function safeParse(raw: string | null): PrimeSessionRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PrimeSessionRecord =>
        !!x &&
        typeof (x as PrimeSessionRecord).id === "string" &&
        typeof (x as PrimeSessionRecord).walletAddress === "string" &&
        typeof (x as PrimeSessionRecord).openedAt === "number"
    );
  } catch {
    return [];
  }
}

export function loadSessionHistory(address: string): PrimeSessionRecord[] {
  try {
    return safeParse(localStorage.getItem(key(address)));
  } catch {
    return [];
  }
}

function persist(address: string, list: PrimeSessionRecord[]): void {
  try {
    const trimmed = list.slice(0, MAX_ENTRIES);
    localStorage.setItem(key(address), JSON.stringify(trimmed));
  } catch {
    // quota exceeded → ignore silently
  }
}

/**
 * Append a freshly opened session. Idempotent: replaces any existing record
 * with the same id (rotated session ids on the same payment trigger this).
 */
export function appendSessionStarted(
  address: string,
  partial: Pick<
    PrimeSessionRecord,
    | "id"
    | "network"
    | "authorizedAmount"
    | "authorizedAmountDisplay"
    | "openedAt"
    | "settleTxHash"
    | "asset"
    | "payTo"
  >
): PrimeSessionRecord {
  const list = loadSessionHistory(address);
  const record: PrimeSessionRecord = {
    walletAddress: address.toLowerCase(),
    chainId: chainIdFromNetwork(partial.network),
    messageCount: 0,
    ...partial,
  };
  const filtered = list.filter((r) => r.id !== record.id);
  filtered.unshift(record);
  persist(address, filtered);
  return record;
}

/** Increment per-session counters after a successful tools/call. */
export function incrementSessionUsage(
  address: string,
  sessionId: string,
  delta: {
    tokensIn?: number;
    tokensOut?: number;
    /** Optional per-call USDC charge in base units (integer string), if API sends it. */
    usdcChargedBaseUnits?: string;
  }
): void {
  const list = loadSessionHistory(address);
  const idx = list.findIndex((r) => r.id === sessionId);
  if (idx < 0) return;
  const r = list[idx];
  let apiSpent = r.apiReportedSpentBaseUnits;
  const add = delta.usdcChargedBaseUnits;
  if (add && /^\d+$/.test(add)) {
    try {
      apiSpent = ((apiSpent ? BigInt(apiSpent) : 0n) + BigInt(add)).toString();
    } catch {
      /* ignore malformed */
    }
  }
  list[idx] = {
    ...r,
    messageCount: (r.messageCount ?? 0) + 1,
    tokensIn: (r.tokensIn ?? 0) + (delta.tokensIn ?? 0),
    tokensOut: (r.tokensOut ?? 0) + (delta.tokensOut ?? 0),
    ...(apiSpent !== undefined ? { apiReportedSpentBaseUnits: apiSpent } : {}),
  };
  persist(address, list);
}

/** Close a session locally — call from UI when expiry/410/disconnect is observed. */
export function markSessionClosed(
  address: string,
  sessionId: string,
  reason: CloseReason,
  closedAt: number = Date.now()
): void {
  const list = loadSessionHistory(address);
  const idx = list.findIndex((r) => r.id === sessionId);
  if (idx < 0) return;
  if (list[idx].closedAt) return; // first close wins
  list[idx] = { ...list[idx], closedAt, closeReason: reason };
  persist(address, list);
}

/** @returns true if storage was updated */
export function recordSessionRefund(
  address: string,
  sessionId: string,
  refund: { txHash: string; amount: string }
): boolean {
  const list = loadSessionHistory(address);
  const idx = list.findIndex((r) => r.id === sessionId);
  if (idx < 0) return false;
  const r = list[idx];
  if (r.refundTxHash) return false; // already recorded
  const authorizedBig = safeBig(r.authorizedAmount);
  const refundedBig = safeBig(refund.amount);
  const spent =
    authorizedBig != null && refundedBig != null
      ? (authorizedBig - refundedBig).toString()
      : undefined;
  list[idx] = {
    ...r,
    refundTxHash: refund.txHash,
    refundedAmount: refund.amount,
    spentAmount: spent,
  };
  persist(address, list);
  return true;
}

function safeBig(s: string | undefined): bigint | undefined {
  if (!s) return undefined;
  try {
    return BigInt(s);
  } catch {
    return undefined;
  }
}

export function clearSessionHistory(address: string): void {
  try {
    localStorage.removeItem(key(address));
  } catch {
    /* ignore */
  }
}

/**
 * Pick the history row to attach a refund Transfer(log) to.
 * Prefers the active server session id, else the only matching row, else the
 * most recently closed row awaiting a refund.
 */
export function findRefundTargetRecord(
  list: PrimeSessionRecord[],
  opts: { sessionId?: string | null; refundFrom: string }
): PrimeSessionRecord | undefined {
  const from = opts.refundFrom.toLowerCase();
  const escrowLower = FORTYTWO_X402_ESCROW_MONAD.toLowerCase();
  const candidates = list.filter((r) => {
    if (r.refundTxHash) return false;
    const p = effectivePayTo(r);
    if (p && p.toLowerCase() === from) return true;
    // Release transfers are always `from` x402Escrow; `payTo` may name another
    // contract from the 402 payload (facilitator / router). Rows without a
    // resolvable payTo still settle on chain 143 via the known escrow.
    if (from === escrowLower && primeSessionChainId(r) === 143) return true;
    return false;
  });
  if (candidates.length === 0) return undefined;
  if (opts.sessionId) {
    const match = candidates.find((r) => r.id === opts.sessionId);
    if (match) {
      const otherClosed = candidates.some(
        (r) => r.id !== match.id && r.closedAt != null
      );
      // Live session rows still match `from === escrow` (no refundTxHash yet).
      // On-chain release after opening a *new* session must attach to an older
      // *closed* row, not the active one — sessionIdRef tracks the new session.
      if (match.closedAt == null && otherClosed) {
        /* fall through to closedAt sort */
      } else {
        return match;
      }
    }
  }
  if (candidates.length === 1) return candidates[0];
  return [...candidates].sort(
    (a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)
  )[0];
}

/** Format token base units (USDC = 6 dp) → "X.XX". */
export function formatTokenAmount(
  baseUnits: string | undefined,
  decimals = 6
): string {
  if (!baseUnits) return "—";
  try {
    const big = BigInt(baseUnits);
    const factor = 10n ** BigInt(decimals);
    const whole = big / factor;
    const frac = big % factor;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
    return `${whole.toString()}.${fracStr}`;
  } catch {
    return "—";
  }
}
