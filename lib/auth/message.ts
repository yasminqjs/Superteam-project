/**
 * The text a wallet signs to log in. Plain and readable on purpose: the wallet
 * shows it to the user, who should understand what they are approving.
 * The nonce makes every login message unique, so an old signature cannot be reused.
 *
 * It must NOT look like a "Sign-In with Solana" (SIWS) message. Wallets such as
 * Phantom recognise that format by its first line ("<domain> wants you to sign
 * in with your Solana account:") and then validate the whole message strictly;
 * anything slightly off is refused with "The app's signature request cannot be
 * shown due to invalid formatting", before the user sees a prompt. A plain
 * message is simply displayed. test/auth-message.test.ts guards this.
 */
export function buildSignInMessage(input: {
  wallet: string;
  origin: string;
  network: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "Recebi sign-in",
    "",
    "Sign this message to prove this wallet is yours.",
    "It is not a transaction and costs nothing.",
    "",
    `Wallet: ${input.wallet}`,
    `Site: ${input.origin}`,
    `Network: ${input.network}`,
    `Nonce: ${input.nonce}`,
    `Issued at: ${input.issuedAt}`,
  ].join("\n");
}
