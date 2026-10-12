import { requireActor } from "@/lib/auth/account";
import { route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { getTeamView, removeMember } from "@/lib/services/team";

type Context = { params: Promise<{ wallet: string }> };

/** Removes a team member. Their access ends with their next request. */
export const DELETE = route(async (_request: Request, { params }: Context) => {
  const deps = getDeps();
  const actor = await requireActor(deps.store, "owner");
  await removeMember(deps, actor, (await params).wallet);
  return { team: await getTeamView(deps, actor) };
});
