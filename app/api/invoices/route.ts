import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { createInvoice, listInvoiceViews } from "@/lib/services/invoices";
import { recordActivity } from "@/lib/services/team";

export const GET = route(async () => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  return { invoices: await listInvoiceViews(getDeps(), wallet) };
});

export const POST = route(async (request: Request) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "write");
  const invoice = await createInvoice(deps, actor.account, await readJson(request));
  await recordActivity(
    deps,
    actor,
    "invoice.created",
    `${invoice.number} to ${invoice.client_name}, ${invoice.amount} ${invoice.symbol}`,
  );
  return { invoice };
});
