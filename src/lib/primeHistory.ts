import { FORTYTWO_X402_ESCROW_MONAD } from "./usdc";

const KEY_PREFIX = "fortytwo-prime-chat:prime-history:";

export type CloseReason =
  | "idle" // 10min without activity
  | "hard-cap" // 60min from open
  | "402" // server requested re-payment
  | "410" // server reports session gone
  | "manual" // user disconnected wallet / cleared session
  | "error" // unrecoverable error during streaming
  | "refund"; // on-chain refund tx observed (session settled)

export interface PrimeSessionRecord {
  id: string;
  walletAddress: string;
  network: string;
  chainId?: number;
  authorizedAmount: string;
  authorizedAmountDisplay: string;
  asset?: string;
  payTo?: string;

  openedAt: number;
  closedAt?: number;
  closeReason?: CloseReason;

  settleTxHash?: string;
  refundTxHash?: string;
  refundedAmount?: string;
  spentAmount?: string;

  messageCount: number;
  tokensIn?: number;
  tokensOut?: number;
  apiReportedSpentBaseUnits?: string;

  paymentNetwork?: string;
  paymentClient?: string;
  paymentNonce?: string;
  escrowId?: string;
  paymentSignatureB64?: string;
  paymentResponseB64?: string;
  timeoutRefundTxHash?: string;
}

const MAX_ENTRIES = 100;

function key(addr: string): string {
  return KEY_PREFIX + addr.toLowerCase();
}

function chainIdFromNetwork(network: string | undefined): number | undefined {
  if (!network) return undefined;
  const m = /eip155:(\d+)/i.exec(network);
  return m ? Number(m[1]) : undefined;
}

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
  }
}

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
    | "paymentNetwork"
    | "paymentClient"
    | "paymentNonce"
    | "escrowId"
    | "paymentSignatureB64"
    | "paymentResponseB64"
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

export function incrementSessionUsage(
  address: string,
  sessionId: string,
  delta: {
    tokensIn?: number;
    tokensOut?: number;
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
  }
}

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
      // *closed* row, not the active one, sessionIdRef tracks the new session.
      if (match.closedAt == null && otherClosed) {
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

export function listPendingRefundRecords(
  list: PrimeSessionRecord[]
): PrimeSessionRecord[] {
  return list.filter(
    (r) =>
      !r.refundTxHash &&
      !r.timeoutRefundTxHash &&
      !!r.escrowId &&
      (r.closedAt != null || r.closeReason != null)
  );
}

export function recordTimeoutRefundClaim(
  address: string,
  sessionId: string,
  refund: { txHash: string; amount?: string }
): boolean {
  const list = loadSessionHistory(address);
  const idx = list.findIndex((r) => r.id === sessionId);
  if (idx < 0) return false;
  const r = list[idx];
  if (r.timeoutRefundTxHash || r.refundTxHash) return false;
  const authorizedBig = safeBig(r.authorizedAmount);
  const refundedBig = refund.amount ? safeBig(refund.amount) : authorizedBig;
  const spent =
    authorizedBig != null && refundedBig != null
      ? (authorizedBig - refundedBig).toString()
      : undefined;
  list[idx] = {
    ...r,
    timeoutRefundTxHash: refund.txHash,
    refundTxHash: refund.txHash,
    refundedAmount: refund.amount ?? r.authorizedAmount,
    spentAmount: spent ?? "0",
    closeReason: r.closeReason ?? "refund",
    closedAt: r.closedAt ?? Date.now(),
  };
  persist(address, list);
  return true;
}

export function formatTokenAmount(
  baseUnits: string | undefined,
  decimals = 6,
  maxFractionDigits = 2
): string {
  if (!baseUnits) return "–";
  try {
    const big = BigInt(baseUnits);
    const n = Number(big) / 10 ** decimals;
    if (!Number.isFinite(n)) return "–";
    const maxF = Math.max(0, Math.min(maxFractionDigits, decimals));
    const minF = maxF >= 2 ? 2 : 0;
    return n.toLocaleString("en-US", {
      minimumFractionDigits: minF,
      maximumFractionDigits: maxF,
    });
  } catch {
    return "–";
  }
}
