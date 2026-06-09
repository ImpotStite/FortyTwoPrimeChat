/**
 * x402Escrow client helpers: escrowId derivation, getEscrow polling,
 * and permissionless `refundAfterTimeout()` fallback.
 *
 * @see https://docs.fortytwo.network/docs/x402escrow-integration-guide
 * @see https://docs.fortytwo.network/docs/x402escrow-contract-reference
 */

import {
  createPublicClient,
  encodePacked,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { monad, monadHttpTransport } from "./privy";
import { FORTYTWO_X402_ESCROW_MONAD } from "./usdc";

export const X402_ESCROW_ABI = [
  {
    type: "function",
    name: "getEscrow",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "client", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "refundAt", type: "uint256" },
          { name: "canRefund", type: "bool" },
          { name: "timeUntilRefund", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "refundAfterTimeout",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "bytes32" }],
    outputs: [],
  },
] as const;

export function computeEscrowId(client: Address, nonce: Hex): Hex {
  return keccak256(encodePacked(["address", "bytes32"], [client, nonce]));
}

/**
 * Compute escrowId three times; throw if any pass disagrees (defensive check
 * requested for payment / refund wiring).
 */
export function computeEscrowIdVerified(client: Address, nonce: Hex): Hex {
  const pass1 = computeEscrowId(client, nonce);
  const pass2 = keccak256(
    encodePacked(["address", "bytes32"], [client, nonce])
  );
  const pass3 = computeEscrowId(client, nonce);
  if (pass1 !== pass2 || pass2 !== pass3) {
    throw new Error(
      `escrowId verification failed (${pass1} vs ${pass2} vs ${pass3})`
    );
  }
  return pass1;
}

export interface EscrowOnChainView {
  escrowId: Hex;
  client: Address;
  amount: bigint;
  refundAt: bigint;
  canRefund: boolean;
  timeUntilRefund: bigint;
  active: boolean;
}

let cachedReader: PublicClient | null = null;

function getReader(): PublicClient {
  cachedReader ??= createPublicClient({
    chain: monad,
    transport: monadHttpTransport,
  });
  return cachedReader;
}

export async function readEscrowOnChain(
  escrowId: Hex,
  escrowAddress: Address = FORTYTWO_X402_ESCROW_MONAD
): Promise<EscrowOnChainView> {
  const client = getReader();
  const view = await client.readContract({
    address: escrowAddress,
    abi: X402_ESCROW_ABI,
    functionName: "getEscrow",
    args: [escrowId],
  });
  const row = view as {
    client: Address;
    amount: bigint;
    refundAt: bigint;
    canRefund: boolean;
    timeUntilRefund: bigint;
  };
  const active =
    row.client.toLowerCase() !== zeroAddress.toLowerCase() && row.amount > 0n;
  return {
    escrowId,
    client: row.client,
    amount: row.amount,
    refundAt: row.refundAt,
    canRefund: row.canRefund,
    timeUntilRefund: row.timeUntilRefund,
    active,
  };
}

export type TimeoutRefundEligibility =
  | { status: "not_found" }
  | { status: "released" }
  | { status: "waiting"; refundAt: number; secondsLeft: number }
  | { status: "claimable"; amount: bigint; refundAt: number };

/**
 * Whether a timeout refund can be claimed for this escrowId.
 * `released` means no active escrow (normal release or prior refund).
 */
export async function checkTimeoutRefundEligibility(
  escrowId: Hex,
  escrowAddress: Address = FORTYTWO_X402_ESCROW_MONAD
): Promise<TimeoutRefundEligibility> {
  const view = await readEscrowOnChain(escrowId, escrowAddress);
  if (!view.active) {
    return { status: "released" };
  }
  const refundAtMs = Number(view.refundAt) * 1000;
  if (view.canRefund) {
    return {
      status: "claimable",
      amount: view.amount,
      refundAt: refundAtMs,
    };
  }
  const secondsLeft = Number(view.timeUntilRefund);
  if (!Number.isFinite(secondsLeft) || secondsLeft < 0) {
    return { status: "not_found" };
  }
  return {
    status: "waiting",
    refundAt: refundAtMs,
    secondsLeft,
  };
}

export async function claimTimeoutRefund(
  walletClient: WalletClient,
  escrowId: Hex,
  escrowAddress: Address = FORTYTWO_X402_ESCROW_MONAD
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client has no account");
  }
  return walletClient.writeContract({
    account,
    chain: monad,
    address: escrowAddress,
    abi: X402_ESCROW_ABI,
    functionName: "refundAfterTimeout",
    args: [escrowId],
  });
}

export function formatRefundCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "now";
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return `${secondsLeft}s`;
}
