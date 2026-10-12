import { requireActor } from "@/lib/auth/account";
import { badRequest } from "@/lib/errors";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { confirmSeal, prepareSeal } from "@/lib/services/receipts";
import { recordActivity } from "@/lib/services/team";

type Context = { params: Promise<{ id: string }> };

/** Seal step 1: freezes the receipt and returns its hash and the memo to sign. */
export const POST = route(async (_request: Request, { params }: Context) => {
  const actor = await requireActor(getDeps().store, "owner");
  const wallet = actor.account;
  return prepareSeal(getDeps(), wallet, (await params).id);
});

/** Seal step 2: the memo transaction is onchain; verify it and record its signature. */
export const PUT = route(async (request: Request, { params }: Context) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "owner");
  const { signature } = await readJson(request);
  if (typeof signature !== "string" || !signature) throw badRequest("Missing seal signature");
  const receipt = await confirmSeal(deps, actor.account, (await params).id, signature);
  await recordActivity(deps, actor, "receipt.sealed", `${receipt.amount} ${receipt.symbol}`);
  return { receipt };
});
