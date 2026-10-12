/**
 * Row types, mirroring supabase/schema.sql.
 *
 * Money never travels as a float: token amounts are integers in base units
 * kept as text (`amount_raw`), and BRL values and rates are decimal strings
 * (`amount_brl`, `fx_rate`), read from Postgres with a ::text cast.
 */
export type FxRule = "ptax_buy" | "ptax_sell";
export type ContactKind = "client" | "platform" | "self" | "other";
export type ReceiptCategory = "service" | "prize" | "grant" | "own_transfer" | "other";
export type ReceiptSource = "imported" | "invoice";
export type InvoiceStatus = "pending" | "paid";

export const FX_RULES: FxRule[] = ["ptax_buy", "ptax_sell"];
export const CONTACT_KINDS: ContactKind[] = ["client", "platform", "self", "other"];
export const RECEIPT_CATEGORIES: ReceiptCategory[] = [
  "service",
  "prize",
  "grant",
  "own_transfer",
  "other",
];

export interface Profile {
  wallet: string;
  display_name: string | null;
  fx_rule: FxRule;
  created_at: string;
}

export interface Contact {
  id: string;
  owner_wallet: string;
  wallet: string;
  name: string;
  kind: ContactKind;
}

export interface Receipt {
  id: string;
  owner_wallet: string;
  source: ReceiptSource;
  tx_signature: string;
  mint: string;
  amount_raw: string;
  decimals: number;
  payer_wallet: string | null;
  /** ISO timestamp. */
  block_time: string;
  memo: string | null;
  category: ReceiptCategory | null;
  description: string | null;
  contact_id: string | null;
  invoice_id: string | null;
  fx_rule: FxRule | null;
  /** YYYY-MM-DD of the quote actually used. */
  fx_date: string | null;
  fx_rate: string | null;
  amount_brl: string | null;
  /** Canonical JSON. A draft until `seal_signature` is set, immutable after. */
  receipt_json: string | null;
  receipt_hash: string | null;
  seal_signature: string | null;
  created_at: string;
}

export type NewReceipt = Omit<Receipt, "id" | "created_at">;
export type ReceiptPatch = Partial<Omit<Receipt, "id" | "owner_wallet" | "created_at">>;

export interface Invoice {
  id: string;
  number: string;
  owner_wallet: string;
  client_name: string;
  client_email: string | null;
  description: string;
  amount_raw: string;
  mint: string;
  decimals: number;
  reference: string;
  invoice_json: string;
  invoice_hash: string;
  status: InvoiceStatus;
  paid_signature: string | null;
  created_at: string;
  paid_at: string | null;
}

export type NewInvoice = Omit<Invoice, "id" | "status" | "paid_signature" | "created_at" | "paid_at">;

export interface FxRateRow {
  requested_date: string;
  rule: FxRule;
  quote_date: string;
  rate: string;
}

export interface Payout {
  id: string;
  owner_wallet: string;
  amount_raw: string;
  mint: string;
  amount_brl: string;
  pix_key: string;
  provider: string;
  status: string;
  created_at: string;
}

export type NewPayout = Omit<Payout, "id" | "created_at">;

/** A company account: the account of `wallet`, with a name and a team. */
export interface Organization {
  /** The wallet that receives the company's payments. Also the account's key everywhere else. */
  wallet: string;
  name: string;
  /** CNPJ or another tax ID, as typed. Declared by the company, not verified. */
  tax_id: string | null;
  created_at: string;
}

/** A wallet allowed to act on a company account. The company wallet itself is not listed. */
export interface OrgMember {
  org_wallet: string;
  member_wallet: string;
  name: string;
  role: "finance" | "viewer";
  added_by: string;
  created_at: string;
}

/** One line of a company account's audit trail: who did what. */
export interface Activity {
  id: string;
  account_wallet: string;
  actor_wallet: string;
  /** The actor's name on the team when they acted. Kept even if they are later removed. */
  actor_name: string;
  /** A code such as "invoice.created" (see ACTIVITY_LABELS). */
  action: string;
  detail: string | null;
  created_at: string;
}

export type NewActivity = Omit<Activity, "id" | "created_at">;

/**
 * Everything the app needs from a database. Two implementations: Supabase
 * (live mode) and a local JSON file (mock mode).
 */
export interface Store {
  /** Returns the profile for `wallet`, creating it on first sign-in. */
  ensureProfile(wallet: string): Promise<Profile>;
  updateProfile(wallet: string, patch: { display_name?: string | null; fx_rule?: FxRule }): Promise<Profile>;

  listContacts(owner: string): Promise<Contact[]>;
  /** Creates the contact for (owner, wallet) or updates its name and kind. */
  upsertContact(owner: string, input: { wallet: string; name: string; kind: ContactKind }): Promise<Contact>;

  /** Newest payment first. */
  listReceipts(owner: string): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | null>;
  /**
   * Inserts receipts, silently skipping any whose (owner_wallet, tx_signature,
   * mint) already exists. Returns only the rows actually inserted. This is what
   * makes import idempotent without ever overwriting a classification.
   */
  insertReceipts(rows: NewReceipt[]): Promise<Receipt[]>;
  updateReceipt(id: string, patch: ReceiptPatch): Promise<Receipt>;

  /** Newest first. */
  listInvoices(owner: string): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  insertInvoice(row: NewInvoice): Promise<Invoice>;
  markInvoicePaid(id: string, signature: string, paidAt: string): Promise<Invoice>;

  getFxRate(requestedDate: string, rule: FxRule): Promise<FxRateRow | null>;
  saveFxRate(row: FxRateRow): Promise<void>;

  insertPayout(row: NewPayout): Promise<Payout>;
  listPayouts(owner: string): Promise<Payout[]>;

  getOrganization(wallet: string): Promise<Organization | null>;
  /** Several organizations at once; wallets that are not companies are simply absent. */
  listOrganizations(wallets: string[]): Promise<Organization[]>;
  /** Creates the company account for `wallet` or updates its details. */
  saveOrganization(wallet: string, input: { name: string; tax_id: string | null }): Promise<Organization>;

  /** Oldest first. */
  listMembers(orgWallet: string): Promise<OrgMember[]>;
  getMember(orgWallet: string, memberWallet: string): Promise<OrgMember | null>;
  /** Adds the member or updates their name and role. */
  saveMember(row: Omit<OrgMember, "created_at">): Promise<OrgMember>;
  removeMember(orgWallet: string, memberWallet: string): Promise<void>;
  /** Every company account `memberWallet` belongs to. */
  listMemberships(memberWallet: string): Promise<OrgMember[]>;

  insertActivity(row: NewActivity): Promise<void>;
  /** Newest first. */
  listActivity(account: string, limit: number): Promise<Activity[]>;
}
