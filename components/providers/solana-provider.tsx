"use client";

import type { ReactNode } from "react";
import type { ConnectionConfig } from "@solana/web3.js";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { MockWalletAdapter } from "@/lib/mock/wallet-adapter";
import { IS_MOCK } from "@/lib/mode";
import { RPC_URL } from "@/lib/solana/cluster";

// Live mode: Phantom (and Solflare, Backpack...) announce themselves through
// the Wallet Standard and WalletProvider picks them up, so the list is empty.
// Mock mode: the only wallet offered is the built-in demo wallet.
const WALLETS: Adapter[] = IS_MOCK ? [new MockWalletAdapter()] : [];

// Separate keys, so a Phantom selection remembered from live mode is never
// auto-connected in mock mode (and vice versa).
const STORAGE_KEY = IS_MOCK ? "recebiMockWallet" : "recebiWallet";

// Declared once at module level: ConnectionProvider builds a new Connection
// whenever this object's identity changes.
const CONNECTION_CONFIG: ConnectionConfig = { commitment: "confirmed" };

// A warning, not console.error: wallet errors are expected events (the user
// dismissed a request, the wallet refused a message) and the screen that asked
// already shows them. console.error would also pop up Next.js's error overlay
// in development for something that is not a bug.
function logWalletError(error: WalletError) {
  console.warn(`[wallet] ${error.name}: ${error.message}`);
}

/** Gives every client component access to the RPC connection and the user's wallet. */
export function SolanaProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL} config={CONNECTION_CONFIG}>
      <WalletProvider
        wallets={WALLETS}
        autoConnect
        localStorageKey={STORAGE_KEY}
        onError={logWalletError}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
