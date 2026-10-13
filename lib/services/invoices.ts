import { Keypair, PublicKey } from "@solana/web3.js";
import { findStableMint } from "@/lib/config/mints";
import type { Contact, Invoice } from "@/lib/db/types";
import { badRequest, notFound } from "@/lib/errors";
import { NETWORK_ID } from "@/lib/mode";
import { formatTokenAmount, formatUnits, parseUnits } from "@/lib/money/units";
import { hashDocument } from "@/lib/receipts/canonical";
import type { Deps } from "@/lib/services/deps";
import { DEFAULT_CATEGORY, applyFx } from "@/lib/services/receipts";
import { findCompany } from "@/lib/services/team";
import { invoiceMemo } from "@/lib/solana/memo";
import { extractIncomingTransfer, extractMemos, type IncomingTransfer } from "@/lib/solana/parse";
import { buildSolanaPayUrl } from "@/lib/solana/pay";
import { isoSeconds } from "@/lib/time";

/** The invoice whose hash goes into the payment's memo. Hashed as canonical JSON. */
export interface InvoiceDocument {
  type: "recebi.invoice";
  v: 1;
  network: string;
  number: string;
  issuer_wallet: string;
  /**
   * Company accounts only: who issues the invoice, as declared by the company.
   * Absent on personal invoices, which therefore hash exactly as they always did.
   */
  issuer_name?: string;
  issuer_tax_id?: string;
  client_name: string;
  description: string;
  amount: string;
  symbol: string;
  mint: string;
  /** Solana Pay reference: a random public key unique to this invoice. */
  reference: string;
  issued_at: string;
}

/** An invoice as shown to anyone with the link. No e-mail, nothing private. */
export interface InvoiceView {
  id: string;
  number: string;
  issuer_wallet: string;
  /** Set when the invoice was issued by a company account. */
  issuer_name: string | null;
  issuer_tax_id: string | null;
  client_name: string;
  description: string;
  /** Display amount, e.g. "1,200.00". */
  amount: string;
  amount_raw: string;
  symbol: string;
  mint: string;
  decimals: number;
  reference: string;
  invoice_hash: string;
  /** Memo the payment must carry. */
  memo: string;
  solana_pay_url: string;
  status: Invoice["status"];
  paid_signature: string | null;
  paid_at: string | null;
  created_at: string;
  network: string;
}

/** The issuer as written in the hashed document, which is what the payer committed to. */
function issuerOf(invoice: Invoice): { name: string | null; taxId: string | null } {
  try {
    const document = JSON.parse(invoice.invoice_json) as Partial<InvoiceDocument>;
    return { name: document.issuer_name ?? null, taxId: document.issuer_tax_id ?? null };
  } catch {
    return { name: null, taxId: null };
  }
}

export function toInvoiceView(invoice: Invoice): InvoiceView {
  const symbol = findStableMint(invoice.mint)?.symbol ?? "TOKEN";
  const memo = invoiceMemo(invoice.invoice_hash);
  const amountRaw = BigInt(invoice.amount_raw);
  const issuer = issuerOf(invoice);
  return {
    id: invoice.id,
    number: invoice.number,
    issuer_wallet: invoice.owner_wallet,
    issuer_name: issuer.name,
    issuer_tax_id: issuer.taxId,
    client_name: invoice.client_name,
    description: invoice.description,
    amount: formatTokenAmount(amountRaw, invoice.decimals),
    amount_raw: invoice.amount_raw,
    symbol,
    mint: invoice.mint,
    decimals: invoice.decimals,
    reference: invoice.reference,
    invoice_hash: invoice.invoice_hash,
    memo,
    solana_pay_url: buildSolanaPayUrl({
      recipient: invoice.owner_wallet,
      mint: invoice.mint,
      decimals: invoice.decimals,
      amountRaw,
      reference: invoice.reference,
      label: "Yvex Chain",
      message: invoice.number,
      memo,
    }),
    status: invoice.status,
    paid_signature: invoice.paid_signature,
    paid_at: invoice.paid_at,
    created_at: invoice.created_at,
    network: NETWORK_ID,
  };
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw badRequest(`${field} is required`);
  if (text.length > max) throw badRequest(`${field} is too long (${max} characters at most)`);
  return text;
}

export async function createInvoice(
  deps: Deps,
  owner: string,
  body: Record<string, unknown>,
): Promise<InvoiceView> {
  const clientName = requireText(body.client_name, "Client name", 120);
  const description = requireText(body.description, "Description", 500);
  const clientEmail = typeof body.client_email === "string" ? body.client_email.trim() : "";
  const token = findStableMint(String(body.mint ?? ""));
  if (!token) throw badRequest("Choose one of the accepted tokens");

  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(String(body.amount ?? ""), token.decimals);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Invalid amount");
  }
  if (amountRaw <= 0n) throw badRequest("The amount must be greater than zero");

  await deps.store.ensureProfile(owner);
  const existing = await deps.store.listInvoices(owner);
  const number = `INV-${String(existing.length + 1).padStart(4, "0")}`;
  // Only the public key is used: nobody ever needs to sign with a reference.
  const reference = Keypair.generate().publicKey.toBase58();
  const company = await findCompany(deps, owner);

  const document: InvoiceDocument = {
    type: "recebi.invoice",
    v: 1,
    network: NETWORK_ID,
    number,
    issuer_wallet: owner,
    ...(company && { issuer_name: company.name }),
    ...(company?.tax_id && { issuer_tax_id: company.tax_id }),
    client_name: clientName,
    description,
    amount: formatUnits(amountRaw, token.decimals, { minFractionDigits: 2 }),
    symbol: token.symbol,
    mint: token.mint,
    reference,
    issued_at: isoSeconds(deps.now()),
  };
  const { json, hash } = await hashDocument(document);

  return toInvoiceView(
    await deps.store.insertInvoice({
      number,
      owner_wallet: owner,
      client_name: clientName,
      client_email: clientEmail || null,
      description,
      amount_raw: amountRaw.toString(),
      mint: token.mint,
      decimals: token.decimals,
      reference,
      invoice_json: json,
      invoice_hash: hash,
    }),
  );
}

export async function listInvoiceViews(deps: Deps, owner: string): Promise<InvoiceView[]> {
  return (await deps.store.listInvoices(owner)).map(toInvoiceView);
}

async function requireInvoice(deps: Deps, id: string): Promise<Invoice> {
  const invoice = await deps.store.getInvoice(id);
  if (!invoice) throw notFound("Invoice");
  return invoice;
}

export async function getInvoiceView(deps: Deps, id: string): Promise<InvoiceView> {
  return toInvoiceView(await requireInvoice(deps, id));
}

/**
 * Records a valid payment: creates the receipt already classified (service,
 * with the invoice's client as contact), values it in BRL and marks the
 * invoice paid. If a wallet import got to this transaction first, the existing
 * receipt is linked to the invoice instead of being duplicated.
 */
async function settleInvoice(deps: Deps, invoice: Invoice, transfer: IncomingTransfer): Promise<void> {
  const owner = invoice.owner_wallet;
  const profile = await deps.store.ensureProfile(owner);
  // If the user has already named this payer, their name for it wins: an
  // invoice must not rename an existing contact.
  let contact: Contact | null = null;
  if (transfer.payerWallet) {
    const known = (await deps.store.listContacts(owner)).find(
      (entry) => entry.wallet === transfer.payerWallet,
    );
    contact =
      known ??
      (await deps.store.upsertContact(owner, {
        wallet: transfer.payerWallet,
        name: invoice.client_name,
        kind: "client",
      }));
  }
  const blockTime = new Date((transfer.blockTime ?? Math.floor(deps.now().getTime() / 1000)) * 1000);

  const [inserted] = await deps.store.insertReceipts([
    {
      owner_wallet: owner,
      source: "invoice",
      tx_signature: transfer.signature,
      mint: invoice.mint,
      amount_raw: transfer.amountRaw.toString(),
      decimals: invoice.decimals,
      payer_wallet: transfer.payerWallet,
      block_time: blockTime.toISOString(),
      memo: transfer.memo,
      category: "service",
      description: invoice.description,
      contact_id: contact?.id ?? null,
      invoice_id: invoice.id,
      fx_rule: null,
      fx_date: null,
      fx_rate: null,
      amount_brl: null,
      receipt_json: null,
      receipt_hash: null,
      seal_signature: null,
    },
  ]);

  let receipt = inserted;
  if (!receipt) {
    const existing = (await deps.store.listReceipts(owner)).find(
      (row) => row.tx_signature === transfer.signature && row.mint === invoice.mint,
    );
    if (existing && !existing.seal_signature) {
      receipt = await deps.store.updateReceipt(existing.id, {
        source: "invoice",
        invoice_id: invoice.id,
        category: existing.category ?? "service",
        description: existing.description ?? invoice.description,
        contact_id: existing.contact_id ?? contact?.id ?? null,
        receipt_json: null,
        receipt_hash: null,
      });
    }
  }
  if (receipt && !receipt.fx_rate) {
    try {
      await applyFx(deps, receipt, profile.fx_rule);
    } catch (error) {
      console.warn(`[fx] could not value receipt ${receipt.id}:`, error);
    }
  }

  // The payer is a known contact now: recognise their earlier payments too,
  // the same way a wallet import recognises a known payer.
  if (contact) {
    const { id: contactId, wallet: payerWallet, kind } = contact;
    const earlier = (await deps.store.listReceipts(owner)).filter(
      (row) => row.payer_wallet === payerWallet && !row.contact_id && !row.seal_signature,
    );
    for (const row of earlier) {
      await deps.store.updateReceipt(row.id, {
        contact_id: contactId,
        category: row.category ?? DEFAULT_CATEGORY[kind],
        receipt_json: null,
        receipt_hash: null,
      });
    }
  }
  await deps.store.markInvoicePaid(invoice.id, transfer.signature, blockTime.toISOString());
}

/**
 * Looks for the payment of a pending invoice and settles it if found.
 *
 * The invoice's reference key was attached to the transfer as a read-only
 * account, so getSignaturesForAddress(reference) returns exactly the
 * transactions that claim to pay this invoice. A claim is not enough: the
 * transaction must have credited the exact amount of the right token to the
 * issuer and carry the invoice hash in its memo.
 */
export async function checkInvoicePayment(deps: Deps, id: string): Promise<InvoiceView> {
  const invoice = await requireInvoice(deps, id);
  if (invoice.status === "paid") return toInvoiceView(invoice);

  const signatures = await deps.connection.getSignaturesForAddress(
    new PublicKey(invoice.reference),
    { limit: 20 },
    "confirmed",
  );
  const expectedMemo = invoiceMemo(invoice.invoice_hash);

  // Oldest first: if someone pays twice, the first payment settles the invoice.
  for (const info of [...signatures].reverse()) {
    if (info.err) continue;
    const tx = await deps.connection.getParsedTransaction(info.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) continue;
    const transfer = extractIncomingTransfer(tx, invoice.owner_wallet, invoice.mint);
    if (!transfer || transfer.amountRaw !== BigInt(invoice.amount_raw)) continue;
    if (!extractMemos(tx).some((memo) => memo.includes(expectedMemo))) continue;

    await settleInvoice(deps, invoice, transfer);
    return toInvoiceView(await requireInvoice(deps, id));
  }
  return toInvoiceView(invoice);
}

/** Settles every pending invoice of `owner` that has been paid. Used before a wallet import. */
export async function checkPendingInvoices(deps: Deps, owner: string): Promise<void> {
  for (const invoice of await deps.store.listInvoices(owner)) {
    if (invoice.status === "pending") await checkInvoicePayment(deps, invoice.id);
  }
}
