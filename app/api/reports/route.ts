import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { buildMonthlyReport } from "@/lib/services/reports";

/** Monthly report as JSON: receipts of the month and totals by category. */
export const GET = route(async (request: Request) => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  const month = new URL(request.url).searchParams.get("month");
  return { report: await buildMonthlyReport(getDeps(), wallet, month) };
});
