import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { FX_RULE_LABELS } from "@/lib/labels";
import { changeFxRule } from "@/lib/services/receipts";
import { recordActivity } from "@/lib/services/team";

/** Changes the exchange-rate rule and revalues the receipts that are not sealed. */
export const PATCH = route(async (request: Request) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "write");
  const { fx_rule } = await readJson(request);
  const rule = await changeFxRule(deps, actor.account, fx_rule);
  await recordActivity(deps, actor, "fx_rule.changed", FX_RULE_LABELS[rule]);
  return { fx_rule: rule };
});
