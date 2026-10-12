import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { listReceiptViews } from "@/lib/services/receipts";

export const GET = route(async () => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  return { receipts: await listReceiptViews(getDeps(), wallet) };
});
