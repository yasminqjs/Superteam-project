import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * Demo keypairs for mock mode, derived from fixed labels so every machine gets
 * the same addresses.
 *
 * THESE KEYS ARE PUBLIC. Anyone can derive them from this file. They only ever
 * sign transactions for the in-memory mock ledger and must never hold anything
 * on a real network.
 */
function keypairFromLabel(label: string): Keypair {
  const seed = nacl.hash(new TextEncoder().encode(`recebi-mock:${label}`)).slice(0, 32);
  return Keypair.fromSeed(seed);
}

export const MOCK_KEYS = {
  /** The user: a Brazilian developer paid in stablecoins. */
  ana: keypairFromLabel("wallet:ana"),
  /** Ana's second wallet, to demonstrate "own transfer". */
  anaSavings: keypairFromLabel("wallet:ana-savings"),
  /** A colleague who handles the company's invoices: the "Finance" role. */
  bia: keypairFromLabel("wallet:bia"),
  /** The company's outside accountant: the "Read-only" role. */
  caio: keypairFromLabel("wallet:caio"),
  /** A foreign client that pays for services. */
  clientAcme: keypairFromLabel("wallet:client-acme"),
  /** A bounty platform that pays prizes. */
  bountyPlatform: keypairFromLabel("wallet:bounty-platform"),
  /** A payer Ana has never classified. */
  stranger: keypairFromLabel("wallet:stranger"),
  /** Only the public key is used, as the address of the mock stablecoin. */
  mint: keypairFromLabel("mint:usdc"),
};

export const MOCK_MINT_ADDRESS = MOCK_KEYS.mint.publicKey.toBase58();

/** What the mock node answers to getGenesisHash. Not a real network. */
export const MOCK_GENESIS_HASH = keypairFromLabel("genesis").publicKey.toBase58();
