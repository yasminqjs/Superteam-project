import { parseSignInMessageText } from "@solana/wallet-standard-util";
import { describe, expect, it } from "vitest";
import { buildSignInMessage } from "@/lib/auth/message";

const INPUT = {
  wallet: "DWmFNW5rJePdUq6XzckKsaVGURb6H3whbDWnkKqTGoQW",
  origin: "http://localhost:3000",
  network: "solana:devnet",
  nonce: "0123456789abcdef0123456789abcdef",
  issuedAt: "2026-10-11T23:00:00.000Z",
};

describe("buildSignInMessage", () => {
  const message = buildSignInMessage(INPUT);

  it("tells the user what they are signing, for which wallet, site and network", () => {
    expect(message).toContain(INPUT.wallet);
    expect(message).toContain(INPUT.origin);
    expect(message).toContain("solana:devnet");
    expect(message).toContain("not a transaction");
  });

  it("is different for every nonce, so a signature cannot be replayed", () => {
    expect(buildSignInMessage({ ...INPUT, nonce: "ffffffffffffffffffffffffffffffff" })).not.toBe(message);
  });

  // Phantom refuses to display a message it recognises as Sign-In with Solana
  // but cannot validate. Ours is a plain message and must stay unrecognisable.
  it("is not a Sign-In with Solana message", () => {
    expect(message).not.toMatch(/wants you to sign in with your Solana account/i);
    expect(parseSignInMessageText(message)).toBeNull();
  });

  it("the reference parser does recognise the format we must avoid", () => {
    const siws = `localhost:3000 wants you to sign in with your Solana account:\n${INPUT.wallet}`;
    expect(parseSignInMessageText(siws)).not.toBeNull();
  });
});
