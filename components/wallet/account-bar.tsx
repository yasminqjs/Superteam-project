"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { api } from "@/lib/api-client";
import { shortAddress } from "@/lib/format";
import type { AccountOption } from "@/lib/services/team";
import { ROLE_LABELS } from "@/lib/team";

function optionLabel(option: AccountOption): string {
  return option.company
    ? `${option.name} · ${ROLE_LABELS[option.role]}`
    : `Personal · ${shortAddress(option.wallet)}`;
}

/**
 * Says whose books are on screen and lets a team member move between the
 * accounts they can act on. Hidden for someone with a single personal account,
 * for whom there is nothing to say.
 */
export function AccountBar() {
  const { session } = useSession();
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [switching, setSwitching] = useState(false);

  const signer = session.status === "signed_in" ? session.signer : null;
  const companyName = session.status === "signed_in" ? session.companyName : null;

  useEffect(() => {
    if (!signer) return;
    let cancelled = false;
    api<{ accounts: AccountOption[] }>("/api/accounts")
      .then((loaded) => {
        if (!cancelled) setAccounts(loaded.accounts);
      })
      // Without the list there is simply nothing to switch to.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // The company name changes when a company is created: the list changes with it.
  }, [signer, companyName]);

  if (session.status !== "signed_in") return null;
  const choices = signer && accounts ? accounts : [];
  if (!companyName && choices.length < 2) return null;

  async function switchTo(account: string) {
    setSwitching(true);
    try {
      await api("/api/accounts", { json: { account } });
      // A full page load on purpose: everything on screen belongs to the old account.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/app");
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2 text-sm sm:px-8">
        <p>
          <span className="text-muted">{companyName ? "Company account" : "Personal account"}</span>{" "}
          <span className="font-medium">{companyName ?? shortAddress(session.wallet)}</span>
          <span className="text-muted"> · your role: {ROLE_LABELS[session.role]}</span>
        </p>
        {choices.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-muted">Switch account</span>
            <select
              aria-label="Switch account"
              value={session.wallet}
              disabled={switching}
              onChange={(event) => switchTo(event.target.value)}
              className="h-8 rounded-md border border-line bg-paper px-2 text-sm"
            >
              {choices.map((option) => (
                <option key={option.wallet} value={option.wallet}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
