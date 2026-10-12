import type { Keypair } from "@solana/web3.js";
import { MOCK_KEYS } from "@/lib/mock/keys";

/**
 * Mock mode only: the demo people the built-in wallet can be. Real wallets
 * hold one person's keys; this one can switch person, so a single browser can
 * show a company account from the owner's, a colleague's and the accountant's
 * side. The choice is remembered in localStorage.
 */
export interface MockIdentity {
  id: string;
  label: string;
  /** How the team page suggests adding this person. */
  name: string;
  keypair: Keypair;
}

export const MOCK_IDENTITIES: MockIdentity[] = [
  { id: "ana", label: "Ana (company wallet)", name: "Ana", keypair: MOCK_KEYS.ana },
  { id: "bia", label: "Bia (finance)", name: "Bia", keypair: MOCK_KEYS.bia },
  { id: "caio", label: "Caio (accountant)", name: "Caio", keypair: MOCK_KEYS.caio },
];

const STORAGE_KEY = "recebiMockIdentity";

export function currentMockIdentity(): MockIdentity {
  let id: string | null = null;
  try {
    id = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // No storage (server render, private mode): the default person.
  }
  return MOCK_IDENTITIES.find((person) => person.id === id) ?? MOCK_IDENTITIES[0];
}

export function setMockIdentity(id: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // Nothing to remember it in.
  }
}
