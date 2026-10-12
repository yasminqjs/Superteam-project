// End-to-end test of LIVE mode through the HTTP API: real Supabase, real PTAX
// and real transactions on devnet, everything except clicking in Phantom.
//
//   1. npm run seed:demo        (once)
//   2. npm run dev:live         (in another terminal)
//   3. npm run e2e:live
//
// Part A signs in as "ana" and imports and classifies her demo payments.
// Part B issues an invoice from a throwaway wallet, pays it on devnet with the
// client key, seals the receipt on devnet and verifies it.
//
// Every row it writes to Supabase is deleted at the end, so the demo starts
// from an empty dashboard. Part A is skipped if ana already has data.
import { createClient } from "@supabase/supabase-js";
import { Keypair, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { verifyReceipt } from "../lib/receipts/verify";
import { createMemoInstruction } from "../lib/solana/memo";
import { buildPaymentInstructions } from "../lib/solana/pay";
import { devnetConnection, hasKeypair, loadEnv, loadOrCreateKeypair, sendTransaction } from "./lib/devnet";

const BASE = process.argv[2] ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

/** A browser-like session: remembers the cookies the server sets. */
function createSession() {
  const cookies = new Map<string, string>();
  async function call(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && cookies.size > 0) {
      headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (pair.slice(index + 1)) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      else cookies.delete(pair.slice(0, index));
    }
    return response;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test script reading loosely typed JSON
  async function json(method: string, path: string, body?: unknown, auth = true): Promise<{ status: number; body: any }> {
    const response = await call(method, path, body, auth);
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  return { call, json };
}

type Session = ReturnType<typeof createSession>;

/** Signs in the way the browser does, but signing the message with a local key. */
async function signIn(session: Session, wallet: Keypair): Promise<boolean> {
  const address = wallet.publicKey.toBase58();
  const nonce = await session.json("POST", "/api/auth/nonce", { wallet: address });
  if (nonce.status !== 200) {
    console.log(`     login message refused: ${JSON.stringify(nonce.body)}`);
    return false;
  }
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.body.message), wallet.secretKey));
  return (await session.json("POST", "/api/auth/verify", { wallet: address, signature })).status === 200;
}

async function main() {
  loadEnv();
  if (!hasKeypair("client-acme") || !hasKeypair("test-mint") || !hasKeypair("ana")) {
    console.error("Demo wallets not found. Run `npm run seed:demo` first.");
    process.exit(1);
  }
  const probe = await fetch(`${BASE}/api/mock/reset`, { method: "POST" }).catch(() => null);
  if (!probe) {
    console.error(`No server at ${BASE}. Start it with \`npm run dev:live\` in another terminal.`);
    process.exit(1);
  }
  if (probe.status !== 404) {
    console.error("This server is in MOCK mode. Start it with `npm run dev:live` and run this again.");
    process.exit(1);
  }

  const connection: Connection = await devnetConnection();
  const ana = loadOrCreateKeypair("ana");
  const acme = loadOrCreateKeypair("client-acme");
  const mint = loadOrCreateKeypair("test-mint").publicKey.toBase58();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Remember which cached rates already existed, to remove only the ones we add.
  const ratesBefore = new Set(
    ((await db.from("fx_rates").select("requested_date, rule")).data ?? []).map((row) => `${row.requested_date}|${row.rule}`),
  );
  const created: string[] = [];
  const removeRowsOf = async (owner: string) => {
    for (const table of ["receipts", "invoices", "payouts", "contacts"]) {
      await db.from(table).delete().eq("owner_wallet", owner);
    }
    await db.from("profiles").delete().eq("wallet", owner);
  };

  try {
    // ----- Part A: ana imports and classifies her real devnet payments -----------
    const anaAddress = ana.publicKey.toBase58();
    const existing = await db.from("receipts").select("*", { count: "exact", head: true }).eq("owner_wallet", anaAddress);
    if ((existing.count ?? 0) > 0) {
      console.log(`Part A skipped: ana already has ${existing.count} receipts in Supabase, and this test must not delete real work.\n`);
    } else {
      created.push(anaAddress);
      const asAna = createSession();
      check("ana signs in with a signed message", await signIn(asAna, ana));

      const imported = await asAna.json("POST", "/api/receipts/import");
      check("import reads ana's 4 payments from devnet into Supabase", imported.body.imported === 4, JSON.stringify(imported.body));
      check("importing again adds nothing", (await asAna.json("POST", "/api/receipts/import")).body.imported === 0);

      const { receipts } = (await asAna.json("GET", "/api/receipts")).body;
      check("every payment has a payer wallet", receipts?.length === 4 && receipts.every((r: { payer_wallet: string | null }) => r.payer_wallet));
      check(
        "every payment is valued in BRL with the real PTAX",
        receipts?.every((r: { amount_brl: string | null; fx: unknown }) => r.amount_brl && r.fx),
        receipts?.map((r: { amount: string; amount_brl: string; fx: { date: string; rate: string } }) => `${r.amount} = R$ ${r.amount_brl} @ ${r.fx?.rate} (${r.fx?.date})`).join("; "),
      );
      const acmePayment = receipts?.find((r: { amount: string }) => r.amount === "1,200.00");
      check("the 1,200 payment came from the client wallet, with its memo", acmePayment?.payer_wallet === acme.publicKey.toBase58() && acmePayment?.memo?.startsWith("Acme Labs"));

      const classified = await asAna.json("PATCH", `/api/receipts/${acmePayment?.id}`, {
        category: "service",
        description: "Web app development, September",
        contact: { name: "Acme Labs", kind: "client" },
      });
      check("classification and contact are stored", classified.body.receipt?.status === "classified" && classified.body.receipt?.contact?.name === "Acme Labs", JSON.stringify(classified.body).slice(0, 120));
      const csv = await (await asAna.call("GET", `/api/reports/csv?month=${acmePayment?.block_time_brt.slice(0, 7)}`)).text();
      check("the CSV export has the classified payment", csv.includes(",service,Acme Labs,"));
    }

    // ----- Part B: invoice, real payment, real seal, verification ----------------
    const issuer = Keypair.generate();
    const issuerAddress = issuer.publicKey.toBase58();
    created.push(issuerAddress);
    // The issuer needs a little SOL to pay the fee of the seal transaction.
    await sendTransaction(
      connection,
      new Transaction().add(SystemProgram.transfer({ fromPubkey: acme.publicKey, toPubkey: issuer.publicKey, lamports: 5_000_000 })),
      [acme],
    );

    const asIssuer = createSession();
    check("a new wallet signs in", await signIn(asIssuer, issuer));
    const invoice = (await asIssuer.json("POST", "/api/invoices", { client_name: "E2E Client", description: "End-to-end test invoice", amount: "25", mint })).body.invoice;
    check("invoice created for the test token", invoice?.number === "INV-0001" && invoice?.symbol === "TUSD", JSON.stringify(invoice ?? {}).slice(0, 120));

    const paymentSignature = await sendTransaction(
      connection,
      new Transaction().add(
        ...buildPaymentInstructions({
          payer: acme.publicKey.toBase58(),
          recipient: issuerAddress,
          mint,
          decimals: invoice.decimals,
          amountRaw: BigInt(invoice.amount_raw),
          memo: invoice.memo,
          reference: invoice.reference,
        }),
      ),
      [acme],
    );
    console.log(`     payment: https://explorer.solana.com/tx/${paymentSignature}?cluster=devnet`);

    // What the pay page does: ask the server every few seconds.
    const startedAt = Date.now();
    let status = (await asIssuer.json("GET", `/api/invoices/${invoice.id}/status`, undefined, false)).body.invoice;
    while (status?.status !== "paid" && Date.now() - startedAt < 45_000) {
      await sleep(3000);
      status = (await asIssuer.json("GET", `/api/invoices/${invoice.id}/status`, undefined, false)).body.invoice;
    }
    check("the pay page's poll sees the payment and flips to paid", status?.status === "paid" && status?.paid_signature === paymentSignature, `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

    const receipt = (await asIssuer.json("GET", "/api/receipts")).body.receipts?.[0];
    check(
      "the payment arrived in Supabase already classified and valued",
      receipt?.source === "invoice" && receipt?.category === "service" && receipt?.contact?.name === "E2E Client" && receipt?.invoice_number === "INV-0001" && Boolean(receipt?.amount_brl),
      `${receipt?.amount} ${receipt?.symbol} = R$ ${receipt?.amount_brl}`,
    );
    check("a wallet import afterwards does not duplicate it", (await asIssuer.json("POST", "/api/receipts/import")).body.imported === 0);

    const draft = (await asIssuer.json("POST", `/api/receipts/${receipt?.id}/seal`)).body;
    check("seal prepared", /^[0-9a-f]{64}$/.test(draft.receipt_hash ?? ""), JSON.stringify(draft).slice(0, 100));
    const sealSignature = await sendTransaction(
      connection,
      new Transaction().add(createMemoInstruction(draft.memo, issuer.publicKey)),
      [issuer],
    );
    console.log(`     seal:    https://explorer.solana.com/tx/${sealSignature}?cluster=devnet`);
    const sealed = await asIssuer.json("PUT", `/api/receipts/${receipt?.id}/seal`, { signature: sealSignature });
    check("the server verified the seal on devnet and recorded it", sealed.body.receipt?.status === "sealed", JSON.stringify(sealed.body).slice(0, 160));

    // What /verify/[id] does in the browser: public data, then the chain.
    const published = (await asIssuer.json("GET", `/api/public/receipts/${receipt?.id}`, undefined, false)).body;
    const verified = await verifyReceipt({ receiptJson: published.receipt_json, sealSignature: published.seal_signature, connection, network: "solana:devnet" });
    check("public verification: Verified", verified.verified, verified.checks.map((c) => `${c.id}:${c.ok ? "ok" : "FAIL"}`).join(" "));
    check("it includes the invoice-hash check", verified.checks.some((c) => c.id === "invoice" && c.ok));
    await sleep(2000);
    const tampered = await verifyReceipt({
      receiptJson: published.receipt_json.replace('"amount":"25.00"', '"amount":"26.00"'),
      sealSignature: published.seal_signature,
      connection,
      network: "solana:devnet",
    });
    check("tamper test: Mismatch on hash and amount", !tampered.verified && tampered.checks.filter((c) => !c.ok).map((c) => c.id).join(",") === "seal_hash,amount", tampered.checks.filter((c) => !c.ok).map((c) => c.id).join(","));

    const dossier = await asIssuer.call("GET", `/api/reports/dossier?ids=${receipt?.id}`);
    check("proof-of-origin PDF", dossier.status === 200 && Buffer.from(await dossier.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");
  } finally {
    for (const owner of created) await removeRowsOf(owner);
    const ratesAfter = (await db.from("fx_rates").select("requested_date, rule")).data ?? [];
    for (const row of ratesAfter) {
      if (!ratesBefore.has(`${row.requested_date}|${row.rule}`)) {
        await db.from("fx_rates").delete().eq("requested_date", row.requested_date).eq("rule", row.rule);
      }
    }
    let left = 0;
    for (const owner of created) {
      left += (await db.from("receipts").select("*", { count: "exact", head: true }).eq("owner_wallet", owner)).count ?? 0;
      left += (await db.from("profiles").select("*", { count: "exact", head: true }).eq("wallet", owner)).count ?? 0;
    }
    check("everything this test wrote to Supabase was removed", left === 0);
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\nThe test crashed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
