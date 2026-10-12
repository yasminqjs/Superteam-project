"use client";

import { useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api-client";
import { MOCK_IDENTITIES, currentMockIdentity, setMockIdentity } from "@/lib/mock/identity";
import { IS_MOCK } from "@/lib/mode";

// The identity only changes through switchIdentity, which reloads the page.
const subscribeToNothing = () => () => {};

/**
 * Always visible in mock mode, on every page. Nobody looking at the screen
 * should be able to mistake simulated data for something onchain.
 */
export function MockBanner() {
  const [resetting, setResetting] = useState(false);
  // The choice lives in localStorage, which the server cannot see: it renders
  // the default person and the browser corrects it on hydration.
  const identity = useSyncExternalStore(
    subscribeToNothing,
    () => currentMockIdentity().id,
    () => MOCK_IDENTITIES[0].id,
  );
  if (!IS_MOCK) return null;

  /** Becomes another demo person: a different wallet, so a different sign-in. */
  async function switchIdentity(id: string) {
    setMockIdentity(id);
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/app");
  }

  async function reset() {
    setResetting(true);
    try {
      await api("/api/mock/reset", { method: "POST" });
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      // A full page load on purpose (not a router navigation): it drops every
      // piece of client state that was built on the old data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    }
  }

  return (
    <div className="bg-ink text-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2 text-xs sm:px-8">
        <p>
          <span className="font-semibold uppercase tracking-wider">Mock mode</span>
          <span className="text-paper/70">
            {" "}
            · simulated ledger, demo wallet and sample exchange rates. Nothing here is onchain.
          </span>
        </p>
        <label className="flex items-center gap-2">
          <span className="text-paper/70">Demo wallet</span>
          <select
            aria-label="Demo wallet"
            value={identity}
            onChange={(event) => switchIdentity(event.target.value)}
            className="rounded border border-paper/30 bg-ink px-1.5 py-0.5 text-paper"
          >
            {MOCK_IDENTITIES.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="underline underline-offset-4 hover:no-underline disabled:opacity-60"
        >
          {resetting ? "Resetting…" : "Reset demo data"}
        </button>
      </div>
    </div>
  );
}
