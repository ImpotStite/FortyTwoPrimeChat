import { defineChain } from "viem";
import type { PrivyClientConfig } from "@privy-io/react-auth";

const RPC_URL =
  (import.meta.env.VITE_MONAD_RPC_URL as string | undefined) ||
  "https://rpc.monad.xyz";

/** Monad mainnet (chainId 143). Native gas token is MON. */
export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
});

export const PRIVY_APP_ID =
  (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) ||
  "cmoiyym2500bd0cl7fchu6n1z";

/**
 * Privy configuration: external wallets only (no email / social / embedded).
 * The user signs the EIP-3009 authorization with their own wallet.
 */
export const privyConfig: PrivyClientConfig = {
  loginMethods: ["wallet"],
  appearance: {
    theme: "dark",
    accentColor: "#d0ff00",
    showWalletLoginFirst: true,
    walletList: ["metamask", "rabby_wallet", "wallet_connect", "rainbow"],
  },
  embeddedWallets: {
    ethereum: { createOnLogin: "off" },
    solana: { createOnLogin: "off" },
  },
  defaultChain: monad,
  supportedChains: [monad],
};
