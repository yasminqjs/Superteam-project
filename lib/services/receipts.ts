import { STABLE_MINTS, findStableMint } from "@/lib/config/mints";
import type {
  Contact,
  ContactKind,
  FxRule,
  Invoice,
  NewReceipt,
  Receipt,
  ReceiptCategory,
} from "@/lib/db/types";
import { CONTACT_KINDS, FX_RULES, RECEIPT_CATEGORIES } from "@/lib/db/types";
import { HttpError, badRequest, notFound } from "@/lib/errors";
import { convertToBrl, resolveRate } from "@/lib/fx/ptax";
import { IS_MOCK, NETWORK_ID } from "@/lib/mode";
import { formatTokenAmount, formatUnits } from "@/lib/money/units";
import { hashDocument } from "@/lib/receipts/canonical";
import type { ReceiptDocument } from "@/lib/receipts/document";
import { RpcUnavailableError, verifyReceipt, type VerificationResult } from "@/lib/receipts/verify";
import type { Deps } from "@/lib/services/deps";
import { scanIncomingTransfers } from "@/lib/solana/import";
import { sealMemo } from "@/lib/solana/memo";
import { brtDate, brtDateTime, isoSeconds } from "@/lib/time";

export type ReceiptStatus = "unclassified" | "classified" | "sealed";

/** A receipt as the UI sees it: the database row plus everything needed to display it. */
export interface ReceiptView {
  id: string;
  source: Receipt["source"];
  tx_signature: string;
  mint: string;
  symbol: string;
  /** Display amount, e.g. "1,200.00". */
  amount: string;
  amount_raw: string;
  decimals: number;
  payer_wallet: string | null;
  block_time: string;
  /** "2026-10-07 11:03", Brasília time. */
  block_time_brt: string;
  memo: string | null;
  category: ReceiptCategory | null;
  description: string | null;
  contact: Pick<Contact, "id" | "name" | "kind"> | null;
  invoice_number: string | null;
  fx: { rule: FxRule; date: string; rate: string } | null;
  amount_brl: string | null;
  status: ReceiptStatus;
  receipt_hash: string | null;
  seal_signature: string | null;
}

/** What a payment from each kind of contact most likely is. */
export const DEFAULT_CATEGORY: Record<ContactKind, ReceiptCategory> = {
  client: "service",
  platform: "prize",
  self: "own_transfer",
  other: "other",
};

/** Label used in receipts and reports for the exchange-rate source. */
export const FX_SOURCE = IS_MOCK ? "PTAX (mock)" : "BCB PTAX";

function statusOf(receipt: Receipt): ReceiptStatus {
  if (receipt.seal_signature) return "sealed";
  return receipt.category ? "classified" : "unclassified";
}

export function toReceiptView(receipt: Receipt, contacts: Contact[], invoices: Invoice[]): ReceiptView {
  const contact = contacts.find((entry) => entry.id === receipt.contact_id) ?? null;
  const invoice = invoices.find((entry) => entry.id === receipt.invoice_id) ?? null;
  const hasFx = receipt.fx_rule && receipt.fx_date && receipt.fx_rate;
  return {
    id: receipt.id,
    source: receipt.source,
    tx_signature: receipt.tx_signature,
    mint: receipt.mint,
    symbol: findStableMint(receipt.mint)?.symbol ?? "TOKEN",
    amount: formatTokenAmount(BigInt(receipt.amount_raw), receipt.decimals),
    amount_raw: receipt.amount_raw,
    decimals: receipt.decimals,
    payer_wallet: receipt.payer_wallet,
    block_time: new Date(receipt.block_time).toISOString(),
    block_time_brt: brtDateTime(new Date(receipt.block_time)),
    memo: receipt.memo,
    category: receipt.category,
    description: receipt.description,
    contact: contact && { id: contact.id, name: contact.name, kind: contact.kind },
    invoice_number: invoice?.number ?? null,
    fx: hasFx ? { rule: receipt.fx_rule!, date: receipt.fx_date!, rate: receipt.fx_rate! } : null,
    amount_brl: receipt.amount_brl,
    status: statusOf(receipt),
    receipt_hash: receipt.receipt_hash,
    seal_signature: receipt.seal_signature,
  };
}

export async function listReceiptViews(deps: Deps, owner: string): Promise<ReceiptView[]> {
  const [receipts, contacts, invoices] = await Promise.all([
    deps.store.listReceipts(owner),
    deps.store.listContacts(owner),
    deps.store.listInvoices(owner),
  ]);
  return receipts.map((receipt) => toReceiptView(receipt, contacts, invoices));
}

/** Loads a receipt and makes sure it belongs to `owner`. */
async function getOwnedReceipt(deps: Deps, owner: string, id: string): Promise<Receipt> {
  const receipt = await deps.store.getReceipt(id);
  if (!receipt || receipt.owner_wallet !== owner) throw notFound("Receipt");
  return receipt;
}

async function viewOf(deps: Deps, owner: string, receipt: Receipt): Promise<ReceiptView> {
  const [contacts, invoices] = await Promise.all([
    deps.store.listContacts(owner),
    deps.store.listInvoices(owner),
  ]);
  return toReceiptView(receipt, contacts, invoices);
}

export async function getReceiptView(deps: Deps, owner: string, id: string): Promise<ReceiptView> {
  return viewOf(deps, owner, await getOwnedReceipt(deps, owner, id));
}

/**
 * Values a receipt in reais: looks up the PTAX rate for the payment's date in
 * Brasília time and stores the rule, the quote date actually used, the rate
 * and the result. Never touches a sealed receipt.
 */
export async function applyFx(deps: Deps, receipt: Receipt, rule: FxRule): Promise<Receipt> {
  if (receipt.seal_signature) return receipt;
  const resolved = await resolveRate(
    { store: deps.store, fetcher: deps.fetchPtax, today: brtDate(deps.now()) },
    brtDate(new Date(receipt.block_time)),
    rule,
  );
  return deps.store.updateReceipt(receipt.id, {
    fx_rule: rule,
    fx_date: resolved.quoteDate,
    fx_rate: resolved.rate,
    amount_brl: convertToBrl(BigInt(receipt.amount_raw), receipt.decimals, resolved.rate),
    // The BRL value is part of the receipt: any draft is now stale.
    receipt_json: null,
    receipt_hash: null,
  });
}

/** Like applyFx, but a failing exchange-rate lookup must not fail the caller. */
async function tryApplyFx(deps: Deps, receipt: Receipt, rule: FxRule): Promise<void> {
  try {
    await applyFx(deps, receipt, rule);
  } catch (error) {
    console.warn(`[fx] could not value receipt ${receipt.id}:`, error);
  }
}

/**
 * "Import from wallet": scans the chain for incoming stablecoin payments and
 * stores the ones not seen before. Safe to run any number of times.
 */
export async function importReceipts(
  deps: Deps,
  owner: string,
): Promise<{ imported: number; scanned: number }> {
  const profile = await deps.store.ensureProfile(owner);
  const { transfers, scanned } = await scanIncomingTransfers(deps.connection, owner, STABLE_MINTS);
  const contacts = await deps.store.listContacts(owner);

  const rows: NewReceipt[] = [];
  for (const transfer of transfers) {
    if (transfer.blockTime === null) continue;
    // A payer we already know is recognised on arrival.
    const contact = contacts.find((entry) => entry.wallet === transfer.payerWallet) ?? null;
    rows.push({
      owner_wallet: owner,
      source: "imported",
      tx_signature: transfer.signature,
      mint: transfer.mint,
      amount_raw: transfer.amountRaw.toString(),
      decimals: transfer.decimals,
      payer_wallet: transfer.payerWallet,
      block_time: new Date(transfer.blockTime * 1000).toISOString(),
      memo: transfer.memo,
      category: contact ? DEFAULT_CATEGORY[contact.kind] : null,
      description: null,
      contact_id: contact?.id ?? null,
      invoice_id: null,
      fx_rule: null,
      fx_date: null,
      fx_rate: null,
      amount_brl: null,
      receipt_json: null,
      receipt_hash: null,
      seal_signature: null,
    });
  }
  const inserted = await deps.store.insertReceipts(rows);

  // Value the new receipts, plus any older one whose rate lookup failed before.
  const pending = (await deps.store.listReceipts(owner)).filter((receipt) => !receipt.fx_rate);
  for (const receipt of pending) await tryApplyFx(deps, receipt, profile.fx_rule);

  return { imported: inserted.length, scanned };
}

export interface ClassifyInput {
  category: ReceiptCategory | null;
  description: string | null;
  /** Names the payer. Omit to leave the contact as it is. */
  contact: { name: string; kind: ContactKind } | null;
}

/** Validates the body of PATCH /api/receipts/[id]. */
export function parseClassifyInput(body: Record<string, unknown>): ClassifyInput {
  const category = body.category ?? null;
  if (category !== null && !RECEIPT_CATEGORIES.includes(category as ReceiptCategory)) {
    throw badRequest("Unknown category");
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 500) throw badRequest("Description is too long (500 characters at most)");

  let contact: ClassifyInput["contact"] = null;
  if (typeof body.contact === "object" && body.contact !== null) {
    const { name, kind } = body.contact as Record<string, unknown>;
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed) {
      if (trimmed.length > 120) throw badRequest("Contact name is too long (120 characters at most)");
      if (!CONTACT_KINDS.includes(kind as ContactKind)) throw badRequest("Unknown contact kind");
      contact = { name: trimmed, kind: kind as ContactKind };
    }
  }
  return { category: category as ReceiptCategory | null, description: description || null, contact };
}

/**
 * Saves what the user says a payment is. Naming the payer creates a contact,
 * and the contact is then applied to the payer's other unsealed receipts, so
 * one classification covers past and future payments from that wallet.
 */
export async function classifyReceipt(
  deps: Deps,
  owner: string,
  id: string,
  input: ClassifyInput,
): Promise<ReceiptView> {
  const receipt = await getOwnedReceipt(deps, owner, id);
  if (receipt.seal_signature) {
    throw new HttpError(409, "This receipt is sealed and can no longer be changed.");
  }

  let contactId = receipt.contact_id;
  if (input.contact) {
    if (!receipt.payer_wallet) {
      throw badRequest("This payment has no payer wallet, so it cannot be linked to a contact.");
    }
    const contact = await deps.store.upsertContact(owner, {
      wallet: receipt.payer_wallet,
      ...input.contact,
    });
    contactId = contact.id;

    const siblings = (await deps.store.listReceipts(owner)).filter(
      (other) =>
        other.id !== id && other.payer_wallet === receipt.payer_wallet && !other.seal_signature,
    );
    for (const sibling of siblings) {
      await deps.store.updateReceipt(sibling.id, {
        contact_id: contact.id,
        category: sibling.category ?? DEFAULT_CATEGORY[contact.kind],
        receipt_json: null,
        receipt_hash: null,
      });
    }
  }

  const updated = await deps.store.updateReceipt(id, {
    category: input.category,
    description: input.description,
    contact_id: contactId,
    receipt_json: null,
    receipt_hash: null,
  });
  return viewOf(deps, owner, updated);
}

/** Re-reads the PTAX rate for one receipt (e.g. after today's quote is published). */
export async function refreshFx(deps: Deps, owner: string, id: string): Promise<ReceiptView> {
  const receipt = await getOwnedReceipt(deps, owner, id);
  if (receipt.seal_signature) {
    throw new HttpError(409, "This receipt is sealed and can no longer be changed.");
  }
  const profile = await deps.store.ensureProfile(owner);
  return viewOf(deps, owner, await applyFx(deps, receipt, profile.fx_rule));
}

/** Changes the user's rate rule and revalues every receipt that is not sealed yet. */
export async function changeFxRule(deps: Deps, owner: string, rule: unknown): Promise<FxRule> {
  if (!FX_RULES.includes(rule as FxRule)) throw badRequest("Unknown exchange-rate rule");
  await deps.store.updateProfile(owner, { fx_rule: rule as FxRule });
  for (const receipt of await deps.store.listReceipts(owner)) {
    if (!receipt.seal_signature) await tryApplyFx(deps, receipt, rule as FxRule);
  }
  return rule as FxRule;
}

export interface SealDraft {
  receipt_json: string;
  receipt_hash: string;
  /** The exact text to put in the Memo instruction. */
  memo: string;
}

/**
 * Step 1 of sealing: freezes the receipt's content into canonical JSON and
 * returns the hash for the wallet to sign into a memo. Nothing is sealed yet.
 */
export async function prepareSeal(deps: Deps, owner: string, id: string): Promise<SealDraft> {
  const receipt = await getOwnedReceipt(deps, owner, id);
  if (receipt.seal_signature) throw new HttpError(409, "This receipt is already sealed.");
  if (!receipt.category) throw badRequest("Classify this payment before sealing it.");
  if (!receipt.amount_brl || !receipt.fx_rate || !receipt.fx_date || !receipt.fx_rule) {
    throw badRequest("This payment has no BRL value yet. Refresh the exchange rate first.");
  }

  const contact = (await deps.store.listContacts(owner)).find(
    (entry) => entry.id === receipt.contact_id,
  );
  const invoice = receipt.invoice_id ? await deps.store.getInvoice(receipt.invoice_id) : null;

  const document: ReceiptDocument = {
    type: "recebi.receipt",
    v: 1,
    network: NETWORK_ID,
    amount: formatUnits(BigInt(receipt.amount_raw), receipt.decimals, { minFractionDigits: 2 }),
    symbol: findStableMint(receipt.mint)?.symbol ?? "TOKEN",
    mint: receipt.mint,
    amount_brl: receipt.amount_brl,
    fx: { source: FX_SOURCE, rule: receipt.fx_rule, date: receipt.fx_date, rate: receipt.fx_rate },
    block_time: isoSeconds(new Date(receipt.block_time)),
    payment_tx: receipt.tx_signature,
    payer_wallet: receipt.payer_wallet,
    recipient_wallet: owner,
    category: receipt.category,
    counterparty: contact?.name ?? null,
    description: receipt.description,
    invoice_hash: invoice?.invoice_hash ?? null,
    issued_at: isoSeconds(deps.now()),
  };
  const { json, hash } = await hashDocument(document);
  await deps.store.updateReceipt(id, { receipt_json: json, receipt_hash: hash });
  return { receipt_json: json, receipt_hash: hash, memo: sealMemo(hash, receipt.tx_signature) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 2 of sealing: the wallet has sent the memo transaction. Before storing
 * its signature we run the same verification any third party would run, so the
 * database can never hold a seal that does not check out.
 */
export async function confirmSeal(
  deps: Deps,
  owner: string,
  id: string,
  signature: string,
): Promise<ReceiptView> {
  const receipt = await getOwnedReceipt(deps, owner, id);
  if (receipt.seal_signature) return viewOf(deps, owner, receipt);
  if (!receipt.receipt_json) throw badRequest("Prepare the seal before confirming it.");

  // Two things can make a good seal look bad for a moment: the node we ask may
  // be a little behind the one that confirmed the transaction, and the RPC may
  // be rate-limiting us. Both get a few more attempts before we give an answer.
  let result: VerificationResult | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await sleep(1500);
    try {
      result = await verifyReceipt({
        receiptJson: receipt.receipt_json,
        sealSignature: signature,
        connection: deps.connection,
        network: NETWORK_ID,
      });
    } catch (error) {
      if (!(error instanceof RpcUnavailableError)) throw error;
      result = null;
      continue;
    }
    const notFoundYet = result.checks.some(
      (check) => !check.ok && (check.id === "seal_found" || check.id === "payment_found"),
    );
    if (!notFoundYet) break;
  }
  if (!result) {
    throw new HttpError(
      503,
      "The Solana RPC is not answering, so the seal could not be checked yet. " +
        "Your transaction was sent and is safe: wait a moment and try again.",
    );
  }
  if (!result.verified) {
    const failed = result.checks.filter((check) => !check.ok).map((check) => check.label);
    throw new HttpError(422, `The seal did not pass verification: ${failed.join("; ")}`);
  }

  return viewOf(deps, owner, await deps.store.updateReceipt(id, { seal_signature: signature }));
}

/** What the public verify page may know about a receipt: only what was sealed. */
export async function getPublicReceipt(
  deps: Deps,
  id: string,
): Promise<{ receipt_json: string; seal_signature: string }> {
  const receipt = await deps.store.getReceipt(id);
  if (!receipt?.receipt_json || !receipt.seal_signature) throw notFound("Sealed receipt");
  return { receipt_json: receipt.receipt_json, seal_signature: receipt.seal_signature };
}
