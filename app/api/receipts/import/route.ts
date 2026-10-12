import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { checkPendingInvoices } from "@/lib/services/invoices";
import { importReceipts } from "@/lib/services/receipts";
import { recordActivity } from "@/lib/services/team";

// Scanning a long history against a rate-limited RPC can take a while.
export const maxDuration = 60;

/** "Import from wallet". Idempotent: running it twice imports nothing new. */
export const POST = route(async () => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "write");
  // Invoice payments first, so they arrive linked to their invoice.
  await checkPendingInvoices(deps, actor.account);
  const result = await importReceipts(deps, actor.account);
  if (result.imported > 0) {
    await recordActivity(deps, actor, "receipts.imported", `${result.imported} new`);
  }
  return result;
});
