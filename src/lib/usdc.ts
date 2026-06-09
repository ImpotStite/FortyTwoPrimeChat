/**
 * USDC balance reader for Monad mainnet.
 *
 * The USDC asset address used by Fortytwo on Monad was observed in a real
 * `payment-required` payload: 0x754704Bc059F8C67012fEd69BC8A327a5aafb603.
 * We read `balanceOf` with a viem public client over the configured RPC URL.
 */

import {
  createPublicClient,
  formatUnits,
  type Address,
  type PublicClient,
} from "viem";
import { monad, monadHttpTransport } from "./privy";

export const USDC_MONAD_ADDRESS: Address =
  "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

/**
 * Fortytwo x402Escrow contract on Monad (same address on Base per docs).
 * Used when older history rows lack `payTo` so we can still match refunds.
 * @see https://docs.fortytwo.network/docs/mcp-integration
 */
export const FORTYTWO_X402_ESCROW_MONAD: Address =
  "0x9562f50f73d8eE22276F13A18D051456d8D137a0";

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
    transport: monadHttpTransport,
  });
  return cachedClient;
}

export interface UsdcBalance {
  raw: bigint;
  formatted: string;
  display: string;
}

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
