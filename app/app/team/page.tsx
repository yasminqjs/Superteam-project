"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/components/providers/session-provider";
import {
  AddressText,
  Badge,
  Button,
  Card,
  Eyebrow,
  Field,
  Loading,
  Notice,
  PageTitle,
  inputClass,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { MOCK_IDENTITIES } from "@/lib/mock/identity";
import { IS_MOCK } from "@/lib/mode";
import type { TeamView } from "@/lib/services/team";
import { MEMBER_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type MemberRole, type TeamRole } from "@/lib/team";
import { brtDateTime } from "@/lib/time";

const ROLES_EXPLAINED: TeamRole[] = ["owner", "finance", "viewer"];

export default function TeamPage() {
  const { can, refresh } = useSession();
  const isOwner = can("owner");

  const [team, setTeam] = useState<TeamView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Company form.
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [companySaved, setCompanySaved] = useState(false);

  // New member form.
  const [memberWallet, setMemberWallet] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<MemberRole>("finance");
  const [savingMember, setSavingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);

  /** Shows the team and resets the company form to its stored values. */
  const show = useCallback((next: TeamView) => {
    setTeam(next);
    setCompanyName(next.company?.name ?? "");
    setTaxId(next.company?.tax_id ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ team: TeamView }>("/api/team")
      .then((loaded) => {
        if (!cancelled) show(loaded.team);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [show]);

  async function saveCompany(event: FormEvent) {
    event.preventDefault();
    setSavingCompany(true);
    setCompanyError(null);
    setCompanySaved(false);
    try {
      const saved = await api<{ team: TeamView }>("/api/team", {
        method: "PUT",
        json: { name: companyName, tax_id: taxId },
      });
      show(saved.team);
      setCompanySaved(true);
      // The header shows the company's name.
      await refresh();
    } catch (caught) {
      setCompanyError(errorMessage(caught));
    } finally {
      setSavingCompany(false);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    setSavingMember(true);
    setMemberError(null);
    try {
      const saved = await api<{ team: TeamView }>("/api/team/members", {
        json: { wallet: memberWallet.trim(), name: memberName, role: memberRole },
      });
      show(saved.team);
      setMemberWallet("");
      setMemberName("");
    } catch (caught) {
      setMemberError(errorMessage(caught));
    } finally {
      setSavingMember(false);
    }
  }

  async function changeRole(wallet: string, name: string, role: MemberRole) {
    setChanging(wallet);
    setMemberError(null);
    try {
      show((await api<{ team: TeamView }>("/api/team/members", { json: { wallet, name, role } })).team);
    } catch (caught) {
      setMemberError(errorMessage(caught));
    } finally {
      setChanging(null);
    }
  }

  async function removeMember(wallet: string) {
    setChanging(wallet);
    setMemberError(null);
    try {
      show((await api<{ team: TeamView }>(`/api/team/members/${wallet}`, { method: "DELETE" })).team);
    } catch (caught) {
      setMemberError(errorMessage(caught));
    } finally {
      setChanging(null);
    }
  }

  if (loadError) return <Notice>{loadError}</Notice>;
  if (!team) return <Loading />;

  const company = team.company;
  const companyDirty =
    companyName.trim() !== (company?.name ?? "") || taxId.trim() !== (company?.tax_id ?? "");
  // Demo people not on the team yet, offered as one-click suggestions in mock mode.
  const suggestions = IS_MOCK
    ? MOCK_IDENTITIES.filter((person) => {
        const address = person.keypair.publicKey.toBase58();
        return address !== team.account && !team.members.some((member) => member.wallet === address);
      })
    : [];

  return (
    <div>
      <PageTitle title="Team" />
      <p className="mt-3 max-w-2xl text-muted">
        A company account is this account with a name, a tax ID and a team. Payments keep arriving
        at the same wallet. Each person signs in with their own wallet and gets a role.
      </p>

      {!isOwner && (
        <div className="mt-6">
          <Notice tone="neutral">
            You are on this account as {ROLE_LABELS[team.role]}. Only the company&apos;s own wallet
            can change the company details and the team.
          </Notice>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <Eyebrow>{company ? "Company" : "Set up a company account"}</Eyebrow>
          {isOwner ? (
            <form onSubmit={saveCompany} className="mt-4 space-y-4">
              <Field label="Company name">
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="e.g. Baía Software Ltda"
                  maxLength={120}
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Tax ID" hint="CNPJ. Optional, shown on invoices and reports">
                <input
                  value={taxId}
                  onChange={(event) => setTaxId(event.target.value)}
                  placeholder="00.000.000/0001-00"
                  maxLength={40}
                  className={inputClass}
                />
              </Field>
              {companyError && <Notice>{companyError}</Notice>}
              <div className="flex items-center gap-4">
                <Button type="submit" busy={savingCompany} disabled={!companyDirty}>
                  {company ? "Save" : "Create company account"}
                </Button>
                {companySaved && !companyDirty && <span className="text-sm text-accent">Saved ✓</span>}
              </div>
            </form>
          ) : (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Name">{company?.name}</Row>
              <Row label="Tax ID">{company?.tax_id ?? <span className="text-muted">Not informed</span>}</Row>
            </dl>
          )}
          <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
            <Row label="Receiving wallet">
              <AddressText address={team.account} chars={6} />
            </Row>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted">
            The name and tax ID are declared by the company. Recebi does not verify them.
          </p>
        </Card>

        <Card>
          <Eyebrow>Roles</Eyebrow>
          <dl className="mt-4 space-y-4 text-sm">
            {ROLES_EXPLAINED.map((role) => (
              <div key={role}>
                <dt className="font-medium">{ROLE_LABELS[role]}</dt>
                <dd className="mt-0.5 leading-6 text-muted">{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      {company && (
        <>
          <section aria-label="Members" className="mt-10">
            <h2 className="font-display text-3xl">Members</h2>
            <ul className="mt-4 divide-y divide-line border-y border-line">
              <li className="flex flex-wrap items-center justify-between gap-3 py-4 sm:px-3">
                <span>
                  <span className="block font-medium">{company.name}</span>
                  <span className="block text-sm text-muted">
                    <AddressText address={team.account} chars={6} />
                  </span>
                </span>
                <Badge tone="accent">{ROLE_LABELS.owner}</Badge>
              </li>
              {team.members.map((member) => (
                <li
                  key={member.wallet}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 sm:px-3"
                >
                  <span>
                    <span className="block font-medium">{member.name}</span>
                    <span className="block text-sm text-muted">
                      <AddressText address={member.wallet} chars={6} />
                    </span>
                  </span>
                  {isOwner ? (
                    <span className="flex items-center gap-3">
                      <select
                        aria-label={`Role of ${member.name}`}
                        value={member.role}
                        disabled={changing === member.wallet}
                        onChange={(event) =>
                          changeRole(member.wallet, member.name, event.target.value as MemberRole)
                        }
                        className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
                      >
                        {MEMBER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeMember(member.wallet)}
                        disabled={changing === member.wallet}
                        className="text-sm text-danger underline-offset-4 hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </span>
                  ) : (
                    <Badge tone="ink">{ROLE_LABELS[member.role]}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {memberError && (
              <div className="mt-4">
                <Notice>{memberError}</Notice>
              </div>
            )}

            {isOwner && (
              <Card className="mt-6">
                <Eyebrow>Add a member</Eyebrow>
                <form onSubmit={addMember} className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem_10rem_auto] sm:items-end">
                  <Field label="Wallet address">
                    <input
                      value={memberWallet}
                      onChange={(event) => setMemberWallet(event.target.value)}
                      placeholder="Their Solana address"
                      required
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                  <Field label="Name">
                    <input
                      value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                      placeholder="e.g. Bia"
                      maxLength={80}
                      required
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Role">
                    <select
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value as MemberRole)}
                      className={inputClass}
                    >
                      {MEMBER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" busy={savingMember}>
                    Add member
                  </Button>
                </form>
                <p className="mt-3 text-sm text-muted">
                  They sign in with that wallet and pick this company under &ldquo;Switch
                  account&rdquo;. No keys are shared.
                </p>
                {suggestions.length > 0 && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
                    Demo wallets:
                    {suggestions.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => {
                          setMemberWallet(person.keypair.publicKey.toBase58());
                          setMemberName(person.name);
                          setMemberRole(person.id === "caio" ? "viewer" : "finance");
                        }}
                        className="rounded border border-line px-2 py-0.5 text-ink hover:border-ink/40"
                      >
                        {person.label}
                      </button>
                    ))}
                  </p>
                )}
              </Card>
            )}
          </section>

          <section aria-label="Activity" className="mt-10">
            <h2 className="font-display text-3xl">Activity</h2>
            <p className="mt-2 text-sm text-muted">Who did what on this account. Newest first.</p>
            {team.activity.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
                {team.activity.map((entry) => (
                  <li key={entry.id} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[9.5rem_11rem_1fr] sm:px-3">
                    <span className="tabular-nums text-muted">{brtDateTime(new Date(entry.created_at))}</span>
                    <span className="font-medium" title={entry.actor_wallet}>
                      {entry.actor_name}
                    </span>
                    <span>
                      {entry.label}
                      {entry.detail && <span className="text-muted"> · {entry.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
