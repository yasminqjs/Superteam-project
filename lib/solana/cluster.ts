import type { Connection } from "@solana/web3.js";
import { MOCK_GENESIS_HASH } from "@/lib/mock/keys";
import { IS_MOCK } from "@/lib/mode";

/** Recebi is a devnet-only MVP. There is no mainnet code path. */
export const CLUSTER = "devnet";

export const PUBLIC_DEVNET_RPC = "https://api.devnet.solana.com";

/**
 * Genesis hash of Solana devnet. An RPC URL says nothing reliable about the
 * network behind it, so we ask the node and compare.
 */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** Throws unless the configured cluster is devnet (or unset). */
export function assertDevnetCluster(value: string | undefined): void {
  const cluster = value?.trim() || CLUSTER;
  if (cluster !== CLUSTER) {
    throw new Error(
      `NEXT_PUBLIC_SOLANA_CLUSTER is "${cluster}", but Yvex Chain only runs on devnet`,
    );
  }
}

/** The configured RPC URL, or the public devnet endpoint when none is set. */
export function resolveRpcUrl(value: string | undefined): string {
  return value?.trim() || PUBLIC_DEVNET_RPC;
}

/** In mock mode the "RPC node" is a route of this very app. */
function mockRpcUrl(): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  return `${origin}/api/mock/rpc`;
}

assertDevnetCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);

/** RPC endpoint for browser code. Server code uses getServerConnection(). */
export const RPC_URL = IS_MOCK ? mockRpcUrl() : resolveRpcUrl(process.env.NEXT_PUBLIC_RPC_URL);

export const NETWORK_LABEL = IS_MOCK ? "Mock ledger" : "Solana Devnet";

const EXPECTED_GENESIS_HASH = IS_MOCK ? MOCK_GENESIS_HASH : DEVNET_GENESIS_HASH;

/** True when the node behind `connection` is the network this mode expects. */
export async function isExpectedNetwork(connection: Connection): Promise<boolean> {
  return (await connection.getGenesisHash()) === EXPECTED_GENESIS_HASH;
}

/** Link to a transaction: Solana Explorer on devnet, our own viewer in mock mode. */
export function explorerTxUrl(signature: string): string {
  if (IS_MOCK) return `/mock/tx/${signature}`;
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}

/** Link to an address on Solana Explorer. Null in mock mode: there is nothing to link to. */
export function explorerAddressUrl(address: string): string | null {
  if (IS_MOCK) return null;
  return `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;
}
