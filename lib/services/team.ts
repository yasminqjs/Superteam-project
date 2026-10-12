import { PublicKey } from "@solana/web3.js";
import type { Actor } from "@/lib/auth/account";
import type { Organization, Store } from "@/lib/db/types";
import { HttpError, badRequest } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import type { Deps } from "@/lib/services/deps";
import {
  ACTIVITY_LABELS,
  MAX_MEMBERS,
  MEMBER_ROLES,
  ROLE_LABELS,
  type MemberRole,
  type TeamRole,
} from "@/lib/team";

/** An account the signed-in wallet can act on. */
export interface AccountOption {
  wallet: string;
  /** The company's name, or null for a personal account. */
  name: string | null;
  role: TeamRole;
  company: boolean;
}

export interface MemberView {
  wallet: string;
  name: string;
  role: MemberRole;
  added_at: string;
}

export interface ActivityView {
  id: string;
  actor_wallet: string;
  actor_name: string;
  label: string;
  detail: string | null;
  created_at: string;
}

export interface TeamView {
  account: string;
  /** The role of whoever is asking. */
  role: TeamRole;
  company: { name: string; tax_id: string | null; created_at: string } | null;
  members: MemberView[];
  activity: ActivityView[];
}

const ACTIVITY_SHOWN = 30;

function isValidWallet(wallet: string): boolean {
  try {
    return new PublicKey(wallet).toBase58() === wallet;
  } catch {
    return false;
  }
}

function text(value: unknown, field: string, max: number, required = true): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed && required) throw badRequest(`${field} is required`);
  if (trimmed.length > max) throw badRequest(`${field} is too long (${max} characters at most)`);
  return trimmed;
}

/**
 * The role `signer` has on `account`, or null if none. An account's own
 * wallet is always its owner; everyone else needs a row in the team.
 */
export async function roleOn(store: Store, signer: string, account: string): Promise<TeamRole | null> {
  if (signer === account) return "owner";
  return (await store.getMember(account, signer))?.role ?? null;
}

/**
 * The company behind an account, or null for a personal account. For callers
 * that only decorate their output with it (an invoice, a PDF header): it also
 * answers null when the lookup itself fails, instead of failing the caller.
 */
export async function findCompany(deps: Deps, wallet: string): Promise<Organization | null> {
  try {
    return await deps.store.getOrganization(wallet);
  } catch {
    return null;
  }
}

/** The signer's own account first, then every company they are a member of. */
export async function listAccounts(deps: Deps, signer: string): Promise<AccountOption[]> {
  const memberships = await deps.store.listMemberships(signer);
  const companies = new Map(
    (await deps.store.listOrganizations([signer, ...memberships.map((m) => m.org_wallet)])).map(
      (company) => [company.wallet, company],
    ),
  );
  const own = companies.get(signer);
  const options: AccountOption[] = [
    { wallet: signer, name: own?.name ?? null, role: "owner", company: Boolean(own) },
  ];
  for (const membership of memberships) {
    const company = companies.get(membership.org_wallet);
    if (company) {
      options.push({ wallet: company.wallet, name: company.name, role: membership.role, company: true });
    }
  }
  return options;
}

export async function getTeamView(deps: Deps, actor: Actor): Promise<TeamView> {
  const company = await deps.store.getOrganization(actor.account);
  if (!company) return { account: actor.account, role: actor.role, company: null, members: [], activity: [] };

  const [members, activity] = await Promise.all([
    deps.store.listMembers(actor.account),
    deps.store.listActivity(actor.account, ACTIVITY_SHOWN),
  ]);
  return {
    account: actor.account,
    role: actor.role,
    company: { name: company.name, tax_id: company.tax_id, created_at: company.created_at },
    members: members.map((member) => ({
      wallet: member.member_wallet,
      name: member.name,
      role: member.role,
      added_at: member.created_at,
    })),
    activity: activity.map((entry) => ({
      id: entry.id,
      actor_wallet: entry.actor_wallet,
      actor_name: entry.actor_name,
      label: ACTIVITY_LABELS[entry.action] ?? entry.action,
      detail: entry.detail,
      created_at: entry.created_at,
    })),
  };
}

/** Turns the account into a company account, or updates the company's details. */
export async function saveCompany(
  deps: Deps,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<Organization> {
  const name = text(body.name, "Company name", 120);
  const taxId = text(body.tax_id, "Tax ID", 40, false);
  const company = await deps.store.saveOrganization(actor.account, { name, tax_id: taxId || null });
  await recordActivity(deps, actor, "company.saved", name);
  return company;
}

/** Adds a team member, or changes the name and role of an existing one. */
export async function saveMember(
  deps: Deps,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<MemberView> {
  const wallet = text(body.wallet, "Wallet address", 64);
  if (!isValidWallet(wallet)) throw badRequest("That is not a valid Solana wallet address");
  if (wallet === actor.account) throw badRequest("The company wallet is already the owner");
  const name = text(body.name, "Name", 80);
  const role = MEMBER_ROLES.find((candidate) => candidate === body.role);
  if (!role) throw badRequest("Choose a role");

  if (!(await deps.store.getOrganization(actor.account))) {
    throw badRequest("Set up the company before adding team members");
  }
  const members = await deps.store.listMembers(actor.account);
  const isNew = !members.some((member) => member.member_wallet === wallet);
  if (isNew && members.length >= MAX_MEMBERS) {
    throw new HttpError(409, `A company account has at most ${MAX_MEMBERS} members`);
  }

  const member = await deps.store.saveMember({
    org_wallet: actor.account,
    member_wallet: wallet,
    name,
    role,
    added_by: actor.signer,
  });
  await recordActivity(deps, actor, "member.saved", `${name} as ${ROLE_LABELS[role]}`);
  return { wallet: member.member_wallet, name: member.name, role: member.role, added_at: member.created_at };
}

export async function removeMember(deps: Deps, actor: Actor, wallet: string): Promise<void> {
  const member = await deps.store.getMember(actor.account, wallet);
  if (!member) return;
  await deps.store.removeMember(actor.account, wallet);
  await recordActivity(deps, actor, "member.removed", member.name);
}

/**
 * Adds a line to the company's audit trail. Personal accounts keep none. This
 * never fails the action it describes: the action has already happened.
 */
export async function recordActivity(
  deps: Deps,
  actor: Actor,
  action: string,
  detail?: string | null,
): Promise<void> {
  try {
    const company = await deps.store.getOrganization(actor.account);
    if (!company) return;
    // The name is written down now: the trail must still read well after the
    // person leaves the team.
    const name =
      actor.signer === actor.account
        ? `${company.name} (owner)`
        : ((await deps.store.getMember(actor.account, actor.signer))?.name ?? shortAddress(actor.signer));
    await deps.store.insertActivity({
      account_wallet: actor.account,
      actor_wallet: actor.signer,
      actor_name: name,
      action,
      detail: detail ?? null,
    });
  } catch (error) {
    console.warn("[activity] not recorded:", error instanceof Error ? error.message : error);
  }
}
