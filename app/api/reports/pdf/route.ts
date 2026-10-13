import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { renderSummaryPdf } from "@/lib/reports/pdf";
import { getDeps } from "@/lib/services/deps";
import { buildMonthlyReport } from "@/lib/services/reports";
import { findCompany } from "@/lib/services/team";

// @react-pdf/renderer needs Node.js APIs.
export const runtime = "nodejs";

/** The month's summary as a PDF. */
export const GET = route(async (request: Request) => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  const month = new URL(request.url).searchParams.get("month");
  const report = await buildMonthlyReport(getDeps(), wallet, month);
  const pdf = await renderSummaryPdf(report, wallet, await findCompany(getDeps(), wallet));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="yvex-chain-summary-${report.month}.pdf"`,
    },
  });
});
