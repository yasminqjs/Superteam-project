import { Keypair, Transaction } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// This file runs the app in mock mode. The variable must be set before any
// module reads it, hence vi.hoisted (which runs before the imports below).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_RECEBI_MODE = "mock";
});

import { MOCK_USDC } from "@/lib/config/mints";
import { FileStore } from "@/lib/db/file-store";
import { fetchMockPtax } from "@/lib/fx/ptax";
import { MOCK_KEYS } from "@/lib/mock/keys";
import { mockPay, seedMock } from "@/lib/mock/seed";
import { verifyReceipt } from "@/lib/receipts/verify";
import type { Deps } from "@/lib/services/deps";
import { checkInvoicePayment, createInvoice } from "@/lib/services/invoices";
import { getPayoutProvider } from "@/lib/services/payouts";
import {
  classifyReceipt,
  confirmSeal,
  getPublicReceipt,
  importReceipts,
  listReceiptViews,
  prepareSeal,
} from "@/lib/services/receipts";
import { buildCsv, buildMonthlyReport } from "@/lib/services/reports";
import { createMemoInstruction } from "@/lib/solana/memo";
import { signAndSend } from "@/lib/solana/send";
import { createMockConnection } from "@/lib/solana/server-connection";
import { weekday } from "@/lib/time";

const ANA = MOCK_KEYS.ana.publicKey.toBase58();
const NOW = new Date("2026-10-14T15:00:00Z"); // a Wednesday

function makeDeps(): Deps {
  return {
    store: new FileStore(),
    connection: createMockConnection(),
    fetchPtax: fetchMockPtax,
    now: () => NOW,
  };
}

/** Sends a memo transaction signed by `signer` through the mock node, as the browser does. */
async function sendMemo(deps: Deps, signer: Keypair, memo: string): Promise<string> {
  return signAndSend({
    connection: deps.connection,
    transaction: new Transaction().add(createMemoInstruction(memo, signer.publicKey)),
    feePayer: signer.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(signer);
      return tx;
    },
  });
}

async function sealFirst(deps: Deps, predicate: (memo: string | null) => boolean) {
  const receipt = (await listReceiptViews(deps, ANA)).find((entry) => predicate(entry.memo))!;
  await classifyReceipt(deps, ANA, receipt.id, {
    category: "service",
    description: "Web app development, September",
    contact: { name: "Acme Labs", kind: "client" },
  });
  const draft = await prepareSeal(deps, ANA, receipt.id);
  const signature = await sendMemo(deps, MOCK_KEYS.ana, draft.memo);
  return { receipt, draft, signature, sealed: await confirmSeal(deps, ANA, receipt.id, signature) };
}

let deps: Deps;

beforeEach(async () => {
  seedMock(NOW);
  deps = makeDeps();
});

describe("mock mode, end to end", () => {
  it("imports the four demo payments, once", async () => {
    expect(await importReceipts(deps, ANA)).toEqual({ imported: 4, scanned: 4 });
    expect(await importReceipts(deps, ANA)).toEqual({ imported: 0, scanned: 4 });

    const receipts = await listReceiptViews(deps, ANA);
    // Newest first: Friday, Wednesday, Monday, and the Saturday before them.
    expect(receipts.map((r) => [r.amount, r.memo, r.status])).toEqual([
      ["300.00", null, "unclassified"],
      ["1,200.00", "Acme Labs: web app development, September", "unclassified"],
      ["85.00", null, "unclassified"],
      ["500.00", "Bounty payout: UI design", "unclassified"],
    ]);
    expect(receipts[1].payer_wallet).toBe(MOCK_KEYS.clientAcme.publicKey.toBase58());
    expect(receipts.every((r) => r.symbol === "USDC" && r.amount_brl !== null)).toBe(true);
  });

  it("values a Saturday payment at Friday's rate", async () => {
    await importReceipts(deps, ANA);
    const bounty = (await listReceiptViews(deps, ANA)).find((r) => r.memo?.startsWith("Bounty"))!;
    expect(weekday(bounty.block_time_brt.slice(0, 10))).toBe(6);
    expect(weekday(bounty.fx!.date)).toBe(5);
    expect(bounty.fx!.rule).toBe("ptax_buy");
  });

  it("recognises a payer the user has already named", async () => {
    await importReceipts(deps, ANA);
    const acme = (await listReceiptViews(deps, ANA)).find((r) => r.amount === "1,200.00")!;
    await classifyReceipt(deps, ANA, acme.id, {
      category: "service",
      description: null,
      contact: { name: "Acme Labs", kind: "client" },
    });

    mockPay({
      payer: MOCK_KEYS.clientAcme,
      recipient: ANA,
      amount: "950.50",
      blockTime: Math.floor(NOW.getTime() / 1000),
    });
    expect((await importReceipts(deps, ANA)).imported).toBe(1);

    const [newest] = await listReceiptViews(deps, ANA);
    expect(newest.amount).toBe("950.50");
    expect(newest.contact?.name).toBe("Acme Labs");
    expect(newest.category).toBe("service");
    expect(newest.status).toBe("classified");
  });

  it("seals a receipt and verifies it using only the chain", async () => {
    await importReceipts(deps, ANA);
    const { sealed, signature } = await sealFirst(deps, (memo) => memo?.startsWith("Acme") ?? false);
    expect(sealed.status).toBe("sealed");

    const published = await getPublicReceipt(deps, sealed.id);
    expect(published.seal_signature).toBe(signature);
    const result = await verifyReceipt({
      receiptJson: published.receipt_json,
      sealSignature: published.seal_signature,
      connection: createMockConnection(),
      network: "recebi:mock",
    });
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual([
      "format",
      "seal_found",
      "seal_hash",
      "seal_signer",
      "payment_found",
      "amount",
      "payer",
    ]);
    expect(result.receipt).toMatchObject({
      amount: "1200.00",
      counterparty: "Acme Labs",
      network: "recebi:mock",
      fx: { source: "PTAX (mock)" },
    });
  });

  it("reports a mismatch when the amount in the receipt is edited", async () => {
    await importReceipts(deps, ANA);
    const { sealed } = await sealFirst(deps, (memo) => memo?.startsWith("Acme") ?? false);
    const published = await getPublicReceipt(deps, sealed.id);

    const tampered = published.receipt_json.replace('"amount":"1200.00"', '"amount":"1300.00"');
    expect(tampered).not.toBe(published.receipt_json);
    const result = await verifyReceipt({
      receiptJson: tampered,
      sealSignature: published.seal_signature,
      connection: deps.connection,
      network: "recebi:mock",
    });
    expect(result.verified).toBe(false);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual([
      "seal_hash",
      "amount",
    ]);
  });

  it("does not accept a mock receipt as a devnet one", async () => {
    await importReceipts(deps, ANA);
    const { sealed } = await sealFirst(deps, (memo) => memo?.startsWith("Acme") ?? false);
    const published = await getPublicReceipt(deps, sealed.id);
    const result = await verifyReceipt({ ...published, receiptJson: published.receipt_json, sealSignature: published.seal_signature, connection: deps.connection, network: "solana:devnet" });
    expect(result.verified).toBe(false);
    expect(result.checks[0]).toMatchObject({ id: "format", ok: false });
  });

  it("refuses a seal signed by another wallet, and a sealed receipt cannot be edited", async () => {
    await importReceipts(deps, ANA);
    const acme = (await listReceiptViews(deps, ANA)).find((r) => r.amount === "1,200.00")!;
    await classifyReceipt(deps, ANA, acme.id, { category: "service", description: null, contact: null });
    const draft = await prepareSeal(deps, ANA, acme.id);

    const forged = await sendMemo(deps, MOCK_KEYS.stranger, draft.memo);
    await expect(confirmSeal(deps, ANA, acme.id, forged)).rejects.toThrow(/signed by the recipient/);

    const genuine = await sendMemo(deps, MOCK_KEYS.ana, draft.memo);
    await confirmSeal(deps, ANA, acme.id, genuine);
    await expect(
      classifyReceipt(deps, ANA, acme.id, { category: "prize", description: null, contact: null }),
    ).rejects.toThrow(/sealed/);
  });

  it("will not seal an unclassified payment, or show another user's receipt", async () => {
    await importReceipts(deps, ANA);
    const [receipt] = await listReceiptViews(deps, ANA);
    await expect(prepareSeal(deps, ANA, receipt.id)).rejects.toThrow(/Classify/);
    const other = MOCK_KEYS.stranger.publicKey.toBase58();
    await expect(prepareSeal(deps, other, receipt.id)).rejects.toThrow(/not found/);
  });

  it("settles an invoice only for the exact amount with the invoice hash in the memo", async () => {
    const invoice = await createInvoice(deps, ANA, {
      client_name: "Acme Labs",
      description: "October retainer",
      amount: "2500",
      mint: MOCK_USDC.mint,
    });
    expect(invoice.number).toBe("INV-0001");
    expect(invoice.status).toBe("pending");
    expect(invoice.solana_pay_url).toBe(
      `solana:${ANA}?amount=2500&spl-token=${MOCK_USDC.mint}&reference=${invoice.reference}` +
        `&label=Recebi&message=INV-0001&memo=${encodeURIComponent(invoice.memo)}`,
    );

    const pay = (amount: string, memo: string) =>
      mockPay({ payer: MOCK_KEYS.clientAcme, recipient: ANA, amount, memo, reference: invoice.reference });

    pay("2499.99", invoice.memo); // wrong amount
    pay("2500", "recebi:inv:v1:not-the-hash"); // wrong memo
    expect((await checkInvoicePayment(deps, invoice.id)).status).toBe("pending");

    const signature = pay("2500", invoice.memo);
    const paid = await checkInvoicePayment(deps, invoice.id);
    expect(paid).toMatchObject({ status: "paid", paid_signature: signature });
    // Checking again changes nothing.
    expect(await checkInvoicePayment(deps, invoice.id)).toEqual(paid);

    const receipts = await listReceiptViews(deps, ANA);
    const receipt = receipts.find((r) => r.tx_signature === signature)!;
    expect(receipt).toMatchObject({
      source: "invoice",
      amount: "2,500.00",
      category: "service",
      description: "October retainer",
      invoice_number: "INV-0001",
      contact: { name: "Acme Labs", kind: "client" },
    });
    expect(receipts.filter((r) => r.source === "invoice")).toHaveLength(1);

    // A receipt for an invoice carries the invoice hash, and verification checks it.
    const draft = await prepareSeal(deps, ANA, receipt.id);
    expect(JSON.parse(draft.receipt_json).invoice_hash).toBe(invoice.invoice_hash);
    const seal = await sendMemo(deps, MOCK_KEYS.ana, draft.memo);
    await confirmSeal(deps, ANA, receipt.id, seal);
    const result = await verifyReceipt({
      receiptJson: draft.receipt_json,
      sealSignature: seal,
      connection: deps.connection,
      network: "recebi:mock",
    });
    expect(result.verified).toBe(true);
    expect(result.checks.at(-1)).toMatchObject({ id: "invoice", ok: true });
  });

  it("a paid invoice makes the payer a contact for their earlier payments too", async () => {
    await importReceipts(deps, ANA);
    const invoice = await createInvoice(deps, ANA, {
      client_name: "Acme Labs",
      description: "October retainer",
      amount: "100",
      mint: MOCK_USDC.mint,
    });
    mockPay({ payer: MOCK_KEYS.clientAcme, recipient: ANA, amount: "100", memo: invoice.memo, reference: invoice.reference });
    await checkInvoicePayment(deps, invoice.id);

    // The 1,200 payment imported earlier came from the same wallet.
    const earlier = (await listReceiptViews(deps, ANA)).find((r) => r.amount === "1,200.00")!;
    expect(earlier.contact?.name).toBe("Acme Labs");
    expect(earlier.category).toBe("service");
    // Payments from other wallets are left alone.
    const bounty = (await listReceiptViews(deps, ANA)).find((r) => r.amount === "500.00")!;
    expect(bounty.contact).toBeNull();
    expect(bounty.category).toBeNull();
  });

  it("an invoice does not rename a contact the user already named", async () => {
    await importReceipts(deps, ANA);
    const acme = (await listReceiptViews(deps, ANA)).find((r) => r.amount === "1,200.00")!;
    await classifyReceipt(deps, ANA, acme.id, {
      category: "service",
      description: null,
      contact: { name: "Acme Labs", kind: "client" },
    });
    const invoice = await createInvoice(deps, ANA, {
      client_name: "ACME Laboratories Inc.",
      description: "October retainer",
      amount: "100",
      mint: MOCK_USDC.mint,
    });
    const signature = mockPay({ payer: MOCK_KEYS.clientAcme, recipient: ANA, amount: "100", memo: invoice.memo, reference: invoice.reference });
    await checkInvoicePayment(deps, invoice.id);

    const paid = (await listReceiptViews(deps, ANA)).find((r) => r.tx_signature === signature)!;
    expect(paid.contact?.name).toBe("Acme Labs");
  });

  it("builds the monthly report and the CSV", async () => {
    await importReceipts(deps, ANA);
    await sealFirst(deps, (memo) => memo?.startsWith("Acme") ?? false);

    const all = await listReceiptViews(deps, ANA);
    const month = all[0].block_time_brt.slice(0, 7);
    const report = await buildMonthlyReport(deps, ANA, month);
    expect(report.receipts.length).toBeGreaterThan(0);
    expect(report.months).toContain(month);
    const counted = report.totals.reduce((sum, total) => sum + total.count, 0);
    expect(counted).toBe(report.receipts.length);

    const csv = buildCsv(all, "https://recebi.example");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "﻿date_brt,tx_signature,explorer_url,category,counterparty,payer_wallet,token,amount," +
        "fx_rule,fx_date,fx_rate,amount_brl,receipt_hash,seal_signature,verify_url,invoice_number",
    );
    expect(lines).toHaveLength(5);
    const sealedLine = lines.find((line) => line.includes("Acme Labs"))!;
    expect(sealedLine).toContain(",service,Acme Labs,");
    expect(sealedLine).toContain(",USDC,1200.00,ptax_buy,");
    expect(sealedLine).toMatch(/https:\/\/recebi\.example\/verify\/[0-9a-f-]{36},$/);
  });

  it("quotes a simulated payout below the PTAX sell rate and moves no tokens", async () => {
    const provider = getPayoutProvider(deps);
    const quote = await provider.quote({ owner: ANA, mint: MOCK_USDC.mint, amount: "1000" });
    expect(quote.simulated).toBe(true);
    expect(quote.spread_bps).toBe(50);
    expect(Number(quote.effective_rate)).toBeLessThan(Number(quote.ptax_rate));
    expect(Number(quote.amount_brl)).toBeCloseTo(1000 * Number(quote.ptax_rate) * 0.995, 1);

    const before = await deps.connection.getParsedTokenAccountsByOwner(MOCK_KEYS.ana.publicKey, {
      mint: MOCK_KEYS.mint.publicKey,
    });
    const payout = await provider.requestPayout({
      owner: ANA,
      mint: MOCK_USDC.mint,
      amount: "1000",
      pixKey: "ana@example.com",
    });
    expect(payout).toMatchObject({ status: "simulated", provider: "simulated_pix" });
    const after = await deps.connection.getParsedTokenAccountsByOwner(MOCK_KEYS.ana.publicKey, {
      mint: MOCK_KEYS.mint.publicKey,
    });
    expect(after.value).toEqual(before.value);
  });
});
