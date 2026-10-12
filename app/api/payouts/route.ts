import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { formatBRL } from "@/lib/money/units";
import { getPayoutProvider } from "@/lib/services/payouts";
import { recordActivity } from "@/lib/services/team";

export const GET = route(async () => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  return { payouts: await getDeps().store.listPayouts(wallet) };
});

/** Records a SIMULATED Pix payout. No tokens move and no Pix is sent. */
export const POST = route(async (request: Request) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "owner");
  const { mint, amount, pix_key } = await readJson(request);
  const payout = await getPayoutProvider(deps).requestPayout({
    owner: actor.account,
    mint: String(mint ?? ""),
    amount: String(amount ?? ""),
    pixKey: String(pix_key ?? ""),
  });
  await recordActivity(deps, actor, "payout.simulated", formatBRL(payout.amount_brl));
  return { payout };
});
