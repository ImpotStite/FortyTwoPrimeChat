/**
 * On-chain refund detection.
 *
 * Fortytwo's escrow contract releases unused funds back to the client wallet
 * after a session closes. Since the server doesn't push us a notification
 * for that release (it can happen minutes later, possibly while we're
 * disconnected), we observe USDC `Transfer(from, to, value)` events directly
 * on Monad and surface a toast + history record on every match.
 *
 * Implementation notes:
 *  - We use `getLogs` polling (every ~12s, ~one Monad block) instead of
 *    `watchContractEvent`, because public RPCs often disable WebSockets.
 *  - We dedupe by `(txHash, logIndex)` to survive re-orgs and overlapping
 *    polling windows.
 *  - We only care about USDC transfers *to* the user with `from` in the set
 *    of watched escrow addresses (402 `payTo` and/or the x402Escrow contract).
 */

import {
  createPublicClient,
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { monad, monadHttpTransport } from "./privy";
import { USDC_MONAD_ADDRESS } from "./usdc";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
const TRANSFER_ABI = [TRANSFER_EVENT] as const;

function decodeTransferFields(
  log: {
    data: Hex;
    topics: readonly Hex[];
  }
): { from: Address; to: Address; value: bigint } | null {
  try {
    const decoded = decodeEventLog({
      abi: TRANSFER_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "Transfer") return null;
    const { from, to, value } = decoded.args as {
      from: Address;
      to: Address;
      value: bigint;
    };
    return { from, to, value };
  } catch {
    return null;
  }
}

/** Approximate Monad blocktime (used to bound the lookback window). */
const POLL_INTERVAL_MS = 12_000;
/** How far back to scan when starting up (catch refunds that landed while away). */
const LOOKBACK_BLOCKS = 1_500n;
/** Narrow block spans for eth_getLogs so public RPC limits are not hit (HTTP 413). */
const MAX_GET_LOGS_BLOCK_SPAN = 320n;

async function getRefundTransferLogs(
  client: PublicClient,
  escrow: Address,
  user: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<Awaited<ReturnType<PublicClient["getLogs"]>>> {
  const out: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  const base = {
    address: USDC_MONAD_ADDRESS,
    event: TRANSFER_EVENT,
    args: { from: escrow, to: user },
  } as const;
  let start = fromBlock;
  while (start <= toBlock) {
    const end =
      start + MAX_GET_LOGS_BLOCK_SPAN - 1n > toBlock
        ? toBlock
        : start + MAX_GET_LOGS_BLOCK_SPAN - 1n;
    const chunk = await client.getLogs({
      ...base,
      fromBlock: start,
      toBlock: end,
    });
    out.push(...chunk);
    start = end + 1n;
  }
  return out;
}

export interface RefundLog {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  to: Address;
  value: bigint;
}

export interface WatchOptions {
  /** User wallet — refunds arrive *to* this address. */
  user: Address;
  /**
   * Escrow `from` addresses to match in USDC `Transfer` logs (402 `payTo`,
   * x402Escrow, etc.). Refunds are transfers *to* `user` with `from` in this set.
   */
  escrows: Address[];
  /** Called for each new refund log. */
  onRefund: (log: RefundLog) => void;
  /** Called once on first error (for dev logging). */
  onError?: (err: unknown) => void;
}

/**
 * Start polling for incoming refunds. Returns an unsubscribe function.
 * Safe to call multiple times for the same wallet — each instance manages
 * its own dedupe set.
 */
export function watchUsdcRefunds(opts: WatchOptions): () => void {
  const { user, escrows, onRefund, onError } = opts;
  const client = createPublicClient({
    chain: monad,
    transport: monadHttpTransport,
  });
  const seen = new Set<string>();
  let stopped = false;
  let lastBlock: bigint | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const uniqueEscrows = [...new Set(escrows.map((a) => a.toLowerCase()))];
      if (uniqueEscrows.length === 0) {
        return;
      }
      const head = await client.getBlockNumber();
      const fromBlock =
        lastBlock != null
          ? lastBlock + 1n
          : head > LOOKBACK_BLOCKS
            ? head - LOOKBACK_BLOCKS
            : 0n;
      if (fromBlock > head) {
        // No new blocks since last tick.
        return;
      }
      const logs: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
      for (const escrow of uniqueEscrows) {
        const chunk = await getRefundTransferLogs(
          client,
          escrow as Address,
          user,
          fromBlock,
          head
        );
        logs.push(...chunk);
      }
      logs.sort((a, b) => {
        const db = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n);
        if (db !== 0n) return Number(db);
        return (a.logIndex ?? 0) - (b.logIndex ?? 0);
      });
      for (const log of logs) {
        if (stopped) return;
        if (
          !log.transactionHash ||
          log.logIndex == null ||
          log.blockNumber == null
        ) {
          continue;
        }
        const id = `${log.transactionHash}:${log.logIndex}`;
        if (seen.has(id)) continue;
        const args = decodeTransferFields(log);
        if (!args) continue;
        seen.add(id);
        onRefund({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          from: args.from,
          to: args.to,
          value: args.value,
        });
      }
      lastBlock = head;
    } catch (err) {
      if (onError) onError(err);
    }
  };

  // Kick off immediately, then poll.
  void tick();
  const handle = setInterval(tick, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
