import { cookies } from "next/headers";
import { ACCOUNT_COOKIE, cookieOptions, getSessionWallet, requireSessionWallet } from "@/lib/auth/session";
import type { Store } from "@/lib/db/types";
import { HttpError } from "@/lib/errors";
import { roleOn } from "@/lib/services/team";
import { DENIED, can, type Permission, type TeamRole } from "@/lib/team";

/**
 * Who is making a request, and on whose account.
 *
 * `signer` is the wallet that signed in. `account` is the wallet whose data
 * the request touches: the signer's own, or a company account the signer is a
 * member of. The choice lives in a cookie, and the cookie is only a wish: the
 * membership is looked up in the database on every request, so removing a
 * member takes effect on their very next click.
 */
export interface Actor {
  signer: string;
  account: string;
  role: TeamRole;
}

const ACCOUNT_DAYS = 7;

async function selectedAccount(): Promise<string | null> {
  return (await cookies()).get(ACCOUNT_COOKIE)?.value ?? null;
}

/**
 * The actor of this request, or a 401/403. Every private API route starts with
 * this, naming the permission it needs.
 */
export async function requireActor(store: Store, permission: Permission): Promise<Actor> {
  const signer = await requireSessionWallet();
  const requested = await selectedAccount();

  let actor: Actor = { signer, account: signer, role: "owner" };
  if (requested && requested !== signer) {
    const role = await roleOn(store, signer, requested);
    // Never fall back to the signer's own account here: a write meant for the
    // company must not land somewhere else.
    if (!role) {
      throw new HttpError(403, "You no longer have access to that company account. Reload the page.");
    }
    actor = { signer, account: requested, role };
  }
  if (!can(actor.role, permission)) throw new HttpError(403, DENIED[permission]);
  return actor;
}

/**
 * The actor for the "who am I" call, which must always answer. If the selected
 * account is no longer accessible (or cannot be checked), it goes back to the
 * signer's own account and forgets the selection.
 */
export async function currentActor(store: Store): Promise<Actor | null> {
  const signer = await getSessionWallet();
  if (!signer) return null;
  const requested = await selectedAccount();
  if (requested && requested !== signer) {
    const role = await roleOn(store, signer, requested).catch(() => null);
    if (role) return { signer, account: requested, role };
    (await cookies()).delete(ACCOUNT_COOKIE);
  }
  return { signer, account: signer, role: "owner" };
}

/** Switches the account the signer acts on, after checking they may. */
export async function selectAccount(store: Store, account: string): Promise<Actor> {
  const signer = await requireSessionWallet();
  const role = await roleOn(store, signer, account);
  if (!role) throw new HttpError(403, DENIED.read);
  const jar = await cookies();
  if (account === signer) jar.delete(ACCOUNT_COOKIE);
  else jar.set(ACCOUNT_COOKIE, account, cookieOptions(ACCOUNT_DAYS * 24 * 60 * 60));
  return { signer, account, role };
}
