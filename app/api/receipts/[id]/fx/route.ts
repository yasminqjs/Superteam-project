import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { refreshFx } from "@/lib/services/receipts";

type Context = { params: Promise<{ id: string }> };

/** Looks up the PTAX rate again for one unsealed receipt. */
export const POST = route(async (_request: Request, { params }: Context) => {
  const actor = await requireActor(getDeps().store, "write");
  const wallet = actor.account;
  return { receipt: await refreshFx(getDeps(), wallet, (await params).id) };
});
