import { currentActor, selectAccount } from "@/lib/auth/account";
import { requireSessionWallet } from "@/lib/auth/session";
import { badRequest } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { listAccounts } from "@/lib/services/team";

/** The accounts the signed-in wallet can act on: its own, and companies it is a member of. */
export const GET = route(async () => {
  const signer = await requireSessionWallet();
  const deps = getDeps();
  const actor = await currentActor(deps.store);
  return { accounts: await listAccounts(deps, signer), current: actor?.account ?? signer };
});

/** Switches to one of those accounts. */
export const POST = route(async (request: Request) => {
  const { account } = await readJson(request);
  if (typeof account !== "string" || !account) throw badRequest("Missing account");
  const actor = await selectAccount(getDeps().store, account);
  return { account: actor.account, role: actor.role };
});
