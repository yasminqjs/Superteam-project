import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { getTeamView, saveCompany } from "@/lib/services/team";

/** The company behind the current account, its team and its audit trail. */
export const GET = route(async () => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "read");
  return { team: await getTeamView(deps, actor) };
});

/** Turns the account into a company account, or updates the company's details. */
export const PUT = route(async (request: Request) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "owner");
  await saveCompany(deps, actor, await readJson(request));
  return { team: await getTeamView(deps, actor) };
});
