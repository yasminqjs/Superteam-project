import { requireActor } from "@/lib/auth/account";
import { badRequest } from "@/lib/errors";
import { requestOrigin, route } from "@/lib/http";
import { renderDossierPdf } from "@/lib/reports/pdf";
import { getDeps } from "@/lib/services/deps";
import { listReceiptViews } from "@/lib/services/receipts";
import { findCompany } from "@/lib/services/team";

// @react-pdf/renderer needs Node.js APIs.
export const runtime = "nodejs";

const MAX_RECEIPTS = 50;

/** "Proof of origin" PDF for the receipts listed in ?ids=a,b,c. */
export const GET = route(async (request: Request) => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0) throw badRequest("Select at least one receipt");
  if (ids.length > MAX_RECEIPTS) throw badRequest(`Select at most ${MAX_RECEIPTS} receipts`);

  // Listing by owner first means an id from another user simply matches nothing.
  const receipts = (await listReceiptViews(getDeps(), wallet)).filter((r) => ids.includes(r.id));
  if (receipts.length === 0) throw badRequest("None of the selected receipts were found");

  const pdf = await renderDossierPdf(
    receipts,
    wallet,
    requestOrigin(request),
    await findCompany(getDeps(), wallet),
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="yvex-chain-proof-of-origin.pdf"',
    },
  });
});
