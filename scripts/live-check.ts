// Checks the LIVE code paths against the real world, without a browser, a
// wallet extension or Supabase. Run with:  npm run check:live
//
// Always:   reads the real PTAX rate from the Central Bank, and scans a real
//           devnet wallet for incoming stablecoin payments.
// If `npm run seed:demo` has been run: also seals a receipt and pays an
//           invoice ON DEVNET with the demo keys, and verifies both. The
//           invoice goes to a throwaway wallet, so ana's history stays clean.
//
// Uses an in-memory database, so it never touches your Supabase project.
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { devnetConnection, hasKeypair, loadEnv, loadOrCreateKeypair } from "./lib/devnet";

// A devnet wallet that receives USDC all the time, for the read-only scan.
const BUSY_DEVNET_WALLET = "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza";
const DEVNET_USDC = { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", symbol: "USDC", decimals: 6, label: "USDC (devnet)" };

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  loadEnv();
  const seeded = hasKeypair("ana") && hasKeypair("test-mint");
  const testMint = seeded ? loadOrCreateKeypair("test-mint").publicKey.toBase58() : null;

  // These must be set before the app's modules are loaded: they read them once.
  process.env.NEXT_PUBLIC_RECEBI_MODE = "live";
  process.env.RECEBI_MOCK_PERSIST = "off";
  process.env.NEXT_PUBLIC_STABLE_MINTS = JSON.stringify(
    testMint ? [DEVNET_USDC, { mint: testMint, symbol: "TUSD", decimals: 6, label: "Test USD (devnet)" }] : [DEVNET_USDC],
  );

  const { fetchBcbPtax, resolveRate } = await import("../lib/fx/ptax");
  const { scanIncomingTransfers } = await import("../lib/solana/import");
  const { STABLE_MINTS } = await import("../lib/config/mints");
  const { brtDate, addDays } = await import("../lib/time");

  // --- 1. PTAX, for real -----------------------------------------------------
  const today = brtDate(new Date());
  const quotes = await fetchBcbPtax(addDays(today, -10), today);
  check("Central Bank PTAX API answers", quotes.length > 0, `${quotes.length} quotes, latest ${quotes.at(-1)?.date} buy ${quotes.at(-1)?.buy}`);
  const memory: { requested_date: string; rule: string; quote_date: string; rate: string }[] = [];
  const fxStore = {
    getFxRate: async () => null,
    saveFxRate: async (row: (typeof memory)[number]) => void memory.push(row),
  };
  // Find the latest Saturday and check it resolves to an earlier business day.
  let saturday = today;
  while (new Date(`${saturday}T12:00:00Z`).getUTCDay() !== 6) saturday = addDays(saturday, -1);
  if (saturday === today) saturday = addDays(saturday, -7);
  const weekend = await resolveRate({ store: fxStore, fetcher: fetchBcbPtax, today }, saturday, "ptax_buy");
  check("a Saturday falls back to an earlier business day", weekend.quoteDate < saturday, `${saturday} -> ${weekend.quoteDate} @ ${weekend.rate}`);

  // --- 2. Import scan, read-only ----------------------------------------------
  const connection: Connection = await devnetConnection();
  const scan = await scanIncomingTransfers(connection, BUSY_DEVNET_WALLET, [DEVNET_USDC], { maxSignaturesPerAccount: 25 });
  check("scan of a real devnet wallet finds incoming USDC", scan.transfers.length > 0, `${scan.transfers.length} incoming of ${scan.scanned} transactions`);
  const sample = scan.transfers[0];
  if (sample) console.log(`     e.g. ${sample.amountRaw} base units from ${sample.payerWallet}, memo ${JSON.stringify(sample.memo)}`);

  if (!seeded) {
    console.log("\nDemo wallets not found: skipping the write tests. Run `npm run seed:demo` first to enable them.");
    return;
  }

  // --- 3. Full flow on devnet with the demo keys -------------------------------
  const { FileStore } = await import("../lib/db/file-store");
  const { NETWORK_ID } = await import("../lib/mode");
  const receipts = await import("../lib/services/receipts");
  const invoices = await import("../lib/services/invoices");
  const { verifyReceipt } = await import("../lib/receipts/verify");
  const { createMemoInstruction } = await import("../lib/solana/memo");
  const { buildPaymentInstructions } = await import("../lib/solana/pay");
  const { signAndSend } = await import("../lib/solana/send");

  const ana = loadOrCreateKeypair("ana");
  const acme = loadOrCreateKeypair("client-acme");
  const owner = ana.publicKey.toBase58();
  const deps = { store: new FileStore(), connection, fetchPtax: fetchBcbPtax, now: () => new Date() };
  const signWith = (keypair: typeof ana) => async (tx: Transaction) => {
    tx.partialSign(keypair);
    return tx;
  };

  const imported = await receipts.importReceipts(deps, owner);
  check("import finds ana's demo payments", imported.imported >= 4, JSON.stringify(imported));
  check("importing again adds nothing", (await receipts.importReceipts(deps, owner)).imported === 0);

  const list = await receipts.listReceiptViews(deps, owner);
  check("every receipt has a BRL value from the real PTAX", list.every((r) => r.amount_brl !== null));
  const target = list.find((r) => r.amount === "1,200.00") ?? list[0];
  await receipts.classifyReceipt(deps, owner, target.id, {
    category: "service",
    description: "Web app development, September",
    contact: { name: "Acme Labs", kind: "client" },
  });

  const draft = await receipts.prepareSeal(deps, owner, target.id);
  const sealSignature = await signAndSend({
    connection,
    transaction: new Transaction().add(createMemoInstruction(draft.memo, ana.publicKey)),
    feePayer: ana.publicKey,
    signTransaction: signWith(ana),
  });
  console.log(`     seal tx: https://explorer.solana.com/tx/${sealSignature}?cluster=devnet`);
  const sealed = await receipts.confirmSeal(deps, owner, target.id, sealSignature);
  check("receipt sealed on devnet", sealed.status === "sealed");

  const published = await receipts.getPublicReceipt(deps, target.id);
  const verified = await verifyReceipt({ receiptJson: published.receipt_json, sealSignature, connection, network: NETWORK_ID });
  check("verification passes against devnet", verified.verified, verified.checks.map((c) => `${c.id}:${c.ok ? "ok" : "FAIL"}`).join(" "));
  const tampered = await verifyReceipt({
    receiptJson: published.receipt_json.replace(/"amount":"[^"]+"/, '"amount":"999999.00"'),
    sealSignature,
    connection,
    network: NETWORK_ID,
  });
  check("a tampered amount is a mismatch", !tampered.verified, tampered.checks.filter((c) => !c.ok).map((c) => c.id).join(","));

  // The invoice is issued by a throwaway wallet, so this test payment never
  // shows up in ana's history and the demo data stays clean.
  const issuer = Keypair.generate().publicKey.toBase58();
  const invoice = await invoices.createInvoice(deps, issuer, {
    client_name: "Acme Labs",
    description: "Live check invoice",
    amount: "12.5",
    mint: STABLE_MINTS.at(-1)!.mint,
  });
  const paySignature = await signAndSend({
    connection,
    transaction: new Transaction().add(
      ...buildPaymentInstructions({
        payer: acme.publicKey.toBase58(),
        recipient: issuer,
        mint: invoice.mint,
        decimals: invoice.decimals,
        amountRaw: BigInt(invoice.amount_raw),
        memo: invoice.memo,
        reference: invoice.reference,
      }),
    ),
    feePayer: acme.publicKey,
    signTransaction: signWith(acme),
  });
  console.log(`     payment tx: https://explorer.solana.com/tx/${paySignature}?cluster=devnet`);
  let status = await invoices.checkInvoicePayment(deps, invoice.id);
  for (let attempt = 0; attempt < 10 && status.status !== "paid"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    status = await invoices.checkInvoicePayment(deps, invoice.id);
  }
  check("invoice detected as paid through its reference key", status.status === "paid" && status.paid_signature === paySignature);
  const invoiceReceipt = (await receipts.listReceiptViews(deps, issuer)).find((r) => r.tx_signature === paySignature);
  check("the invoice payment became a classified receipt", invoiceReceipt?.category === "service" && invoiceReceipt.invoice_number === invoice.number);
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll live checks passed." : `\n${failures} live check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\nLive check crashed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
