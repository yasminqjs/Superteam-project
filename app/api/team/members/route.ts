import { requireActor } from "@/lib/auth/account";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { getTeamView, saveMember } from "@/lib/services/team";

/** Adds a team member by wallet address, or changes an existing member's name and role. */
export const POST = route(async (request: Request) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "owner");
  await saveMember(deps, actor, await readJson(request));
  return { team: await getTeamView(deps, actor) };
});
