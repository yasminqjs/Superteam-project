/**
 * Company accounts: who may do what.
 *
 * An account is always one wallet: the wallet that receives the payments. A
 * company account is that same account with a name, a tax ID and a team. Team
 * members sign in with their own wallets and act on the company's account.
 *
 * This file has no server imports, so pages can use it to decide what to show.
 * The server enforces the same table on every request (lib/auth/account.ts).
 */
export type TeamRole = "owner" | "finance" | "viewer";
/** Roles a member can be given. "owner" is never given: it is the account's own wallet. */
export type MemberRole = Exclude<TeamRole, "owner">;
export type Permission = "read" | "write" | "owner";

export const MEMBER_ROLES: MemberRole[] = ["finance", "viewer"];
export const MAX_MEMBERS = 25;

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  finance: "Finance",
  viewer: "Read-only",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  owner: "The company wallet itself. Seals receipts, cashes out and manages the team.",
  finance: "Imports and classifies payments, creates invoices and prepares reports.",
  viewer: "Sees payments, invoices and reports and downloads them. For accountants and auditors.",
};

const GRANTS: Record<TeamRole, Permission[]> = {
  owner: ["read", "write", "owner"],
  finance: ["read", "write"],
  viewer: ["read"],
};

export function can(role: TeamRole, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

/** Why a request was refused, in words the person can act on. */
export const DENIED: Record<Permission, string> = {
  read: "You do not have access to this account.",
  write: "Your role on this account is read-only.",
  owner:
    "Only the company's own wallet can do this. Sign in with the wallet that receives the payments.",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  "company.saved": "Updated the company details",
  "member.saved": "Added or changed a team member",
  "member.removed": "Removed a team member",
  "receipts.imported": "Imported payments",
  "receipt.classified": "Classified a payment",
  "receipt.sealed": "Sealed a receipt",
  "fx_rule.changed": "Changed the BRL valuation rule",
  "invoice.created": "Created an invoice",
  "payout.simulated": "Simulated a cash-out",
};
