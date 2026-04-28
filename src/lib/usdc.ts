/**
 * USDC balance reader for Monad mainnet.
 *
 * The USDC asset address used by FortyTwo on Monad was observed in a real
 * `payment-required` payload: 0x754704Bc059F8C67012fEd69BC8A327a5aafb603.
 * We read `balanceOf` with a viem public client over the configured RPC URL.
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
  type PublicClient,
} from "viem";
import { monad } from "./privy";

export const USDC_MONAD_ADDRESS: Address =
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

let cachedClient: PublicClient | null = null;
function getClient(): PublicClient {
  if (cachedClient) return cachedClient;
  cachedClient = createPublicClient({
    chain: monad,
    transport: http(),
  });
  return cachedClient;
}

export interface UsdcBalance {
  raw: bigint;
  formatted: string;
  display: string;
}

/** Format with 2 decimals, comma-grouped thousands. */
function formatDisplay(formatted: string): string {
  const [whole, frac = ""] = formatted.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracPart = frac.slice(0, 2).padEnd(2, "0");
  return `${grouped}.${fracPart}`;
}

export async function readUsdcBalance(
  owner: Address
): Promise<UsdcBalance> {
  const client = getClient();
  const raw = (await client.readContract({
    address: USDC_MONAD_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
  const formatted = formatUnits(raw, 6);
  return {
    raw,
    formatted,
    display: formatDisplay(formatted),
  };
}
