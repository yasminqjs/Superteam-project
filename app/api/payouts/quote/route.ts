import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { getPayoutProvider } from "@/lib/services/payouts";

/** A cash-out quote: PTAX sell minus the provider's spread. */
export const POST = route(async (request: Request) => {
  const actor = await requireActor(getDeps().store, "write");
  const wallet = actor.account;
  const { mint, amount } = await readJson(request);
  const quote = await getPayoutProvider(getDeps()).quote({
    owner: wallet,
    mint: String(mint ?? ""),
    amount: String(amount ?? ""),
  });
  return { quote };
});
