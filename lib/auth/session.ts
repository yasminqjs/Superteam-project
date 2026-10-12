import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import nacl from "tweetnacl";
import { buildSignInMessage } from "@/lib/auth/message";
import { ConfigError, HttpError, badRequest } from "@/lib/errors";
import { IS_MOCK, NETWORK_ID } from "@/lib/mode";

/**
 * Wallet login, with no passwords and no session table:
 *
 * 1. /api/auth/nonce writes a login message containing a random nonce and keeps
 *    it in a short-lived signed cookie (the "challenge").
 * 2. The wallet signs the message. Only the holder of the private key can.
 * 3. /api/auth/verify checks the ed25519 signature against the wallet's public
 *    key and, if it matches, issues the session cookie.
 *
 * Both cookies are JWTs signed with SESSION_SECRET and are httpOnly, so page
 * scripts cannot read them.
 */
const SESSION_COOKIE = "recebi_session";
/** Which account the signed-in wallet is acting on. See lib/auth/account.ts. */
export const ACCOUNT_COOKIE = "recebi_account";
const CHALLENGE_COOKIE = "recebi_challenge";
const SESSION_DAYS = 7;
const CHALLENGE_MINUTES = 5;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET?.trim();
  if (value && value.length >= 32) return new TextEncoder().encode(value);
  // Mock mode must run with zero configuration. Its sessions protect nothing real.
  if (IS_MOCK) return new TextEncoder().encode("recebi-mock-mode-session-secret-not-for-production");
  throw new ConfigError("SESSION_SECRET is missing or shorter than 32 characters. Set it in .env.local.");
}

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: maxAgeSeconds,
});

function isValidWallet(wallet: string): boolean {
  try {
    return new PublicKey(wallet).toBase58() === wallet;
  } catch {
    return false;
  }
}

/** Step 1: returns the message the wallet must sign. */
export async function createChallenge(wallet: string, origin: string): Promise<string> {
  if (!isValidWallet(wallet)) throw badRequest("Invalid wallet address");
  const message = buildSignInMessage({
    wallet,
    origin,
    network: NETWORK_ID,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: new Date().toISOString(),
  });
  const token = await new SignJWT({ wallet, message })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${CHALLENGE_MINUTES}m`)
    .sign(secret());
  (await cookies()).set(CHALLENGE_COOKIE, token, cookieOptions(CHALLENGE_MINUTES * 60));
  return message;
}

/** Step 3: checks the signature and opens the session. Returns the wallet. */
export async function verifyChallenge(wallet: string, signatureBase58: string): Promise<string> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (!token) throw new HttpError(401, "The sign-in request expired. Try again.");

  let challenge: Record<string, unknown>;
  try {
    challenge = (await jwtVerify(token, secret())).payload;
  } catch {
    throw new HttpError(401, "The sign-in request expired. Try again.");
  }
  if (challenge.wallet !== wallet || typeof challenge.message !== "string") {
    throw new HttpError(401, "This sign-in request was made for another wallet. Try again.");
  }

  let signature: Uint8Array;
  try {
    signature = bs58.decode(signatureBase58);
  } catch {
    throw badRequest("Malformed signature");
  }
  const valid =
    signature.length === nacl.sign.signatureLength &&
    nacl.sign.detached.verify(
      new TextEncoder().encode(challenge.message),
      signature,
      new PublicKey(wallet).toBytes(),
    );
  if (!valid) throw new HttpError(401, "The signature does not match this wallet.");

  const session = await new SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  jar.set(SESSION_COOKIE, session, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
  jar.delete(CHALLENGE_COOKIE);
  // A new sign-in always starts on the wallet's own account.
  jar.delete(ACCOUNT_COOKIE);
  return wallet;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ACCOUNT_COOKIE);
}

/** The signed-in wallet, or null. */
export async function getSessionWallet(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.wallet === "string" ? payload.wallet : null;
  } catch {
    return null;
  }
}

/** The signed-in wallet, or a 401. Every private API route starts with this. */
export async function requireSessionWallet(): Promise<string> {
  const wallet = await getSessionWallet();
  if (!wallet) throw new HttpError(401, "Sign in with your wallet to continue.");
  return wallet;
}
