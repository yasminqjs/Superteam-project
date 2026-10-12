import { currentActor } from "@/lib/auth/account";
import { getSessionWallet } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { describeSession } from "@/lib/services/session";

/** Who is signed in, if anyone, and which account they are acting on. */
export const GET = route(async () => {
  if (!(await getSessionWallet())) return { wallet: null };
  const deps = getDeps();
  const actor = await currentActor(deps.store);
  return actor ? describeSession(deps, actor) : { wallet: null };
});
