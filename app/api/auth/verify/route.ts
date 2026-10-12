import { verifyChallenge } from "@/lib/auth/session";
import { readJson, route } from "@/lib/http";
import { getDeps } from "@/lib/services/deps";
import { describeSession } from "@/lib/services/session";

/** Login step 2: checks the wallet's signature and opens the session. */
export const POST = route(async (request: Request) => {
  const { wallet, signature } = await readJson(request);
  const signer = await verifyChallenge(String(wallet ?? ""), String(signature ?? ""));
  // A new session always starts on the wallet's own account.
  return describeSession(getDeps(), { signer, account: signer, role: "owner" });
});
