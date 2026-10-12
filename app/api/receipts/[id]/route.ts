import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { CATEGORY_LABELS } from "@/lib/labels";
import { classifyReceipt, getReceiptView, parseClassifyInput } from "@/lib/services/receipts";
import { recordActivity } from "@/lib/services/team";

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Context) => {
  const actor = await requireActor(getDeps().store, "read");
  const wallet = actor.account;
  return { receipt: await getReceiptView(getDeps(), wallet, (await params).id) };
});

/** Classifies a payment: category, description and (optionally) who the payer is. */
export const PATCH = route(async (request: Request, { params }: Context) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "write");
  const input = parseClassifyInput(await readJson(request));
  const receipt = await classifyReceipt(deps, actor.account, (await params).id, input);
  await recordActivity(
    deps,
    actor,
    "receipt.classified",
    `${receipt.amount} ${receipt.symbol} as ${CATEGORY_LABELS[receipt.category ?? "unclassified"]}`,
  );
  return { receipt };
});
