import { requireActor } from "@/lib/auth/account";
import { requestOrigin, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { buildCsv, buildMonthlyReport } from "@/lib/services/reports";

/** The month's receipts as a CSV file for the accountant. */
export const GET = route(async (request: Request) => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  const month = new URL(request.url).searchParams.get("month");
  const report = await buildMonthlyReport(getDeps(), wallet, month);
  return new Response(buildCsv(report.receipts, requestOrigin(request)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="yvex-chain-${report.month}.csv"`,
    },
  });
});
