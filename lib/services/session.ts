import type { Actor } from "@/lib/auth/account";
import type { FxRule } from "@/lib/db/types";
import type { Deps } from "@/lib/services/deps";
import { findCompany } from "@/lib/services/team";
import type { TeamRole } from "@/lib/team";

/** What the browser is told about the current session. */
export interface SessionInfo {
  /** The wallet that signed in. */
  wallet: string;
  /** The account being acted on: the same wallet, or a company's. */
  account: string;
  role: TeamRole;
  /** Set when the account is a company account. */
  company_name: string | null;
  /** The account's rule, not the signer's: the books belong to the account. */
  fx_rule: FxRule;
}

export async function describeSession(deps: Deps, actor: Actor): Promise<SessionInfo> {
  const [profile, company] = await Promise.all([
    deps.store.ensureProfile(actor.account),
    findCompany(deps, actor.account),
  ]);
  return {
    wallet: actor.signer,
    account: actor.account,
    role: actor.role,
    company_name: company?.name ?? null,
    fx_rule: profile.fx_rule,
  };
}
