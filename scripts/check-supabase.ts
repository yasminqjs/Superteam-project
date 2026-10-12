// Tests your real Supabase database through the same code the app uses
// (lib/db/supabase-store.ts). Run with:  npm run check:supabase
//
// It writes a handful of rows under a throwaway owner ("recebi-check-...") and
// deletes them again at the end, whatever happens. Your real data is untouched.
//
//   --dry-run   run the same checks against the in-memory store instead, to
//               check the checks themselves (needs no Supabase project)
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { NewReceipt, Store } from "../lib/db/types";
import { loadEnv } from "./lib/devnet";

const TABLES = ["profiles", "contacts", "receipts", "invoices", "fx_rates", "payouts"];
/** A date no real payment will ever have, so the test exchange rate is easy to remove. */
const SENTINEL_DATE = "1990-01-02";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

function stop(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** What kind of key this is, judged by its format. The key itself is never printed. */
function describeKey(key: string): "service" | "anon" | "unknown" {
  if (key.startsWith("sb_secret_")) return "service";
  if (key.startsWith("sb_publishable_")) return "anon";
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (payload.role === "service_role") return "service";
    if (payload.role === "anon") return "anon";
  } catch {
    // Not a JWT.
  }
  return "unknown";
}

function receipt(owner: string, signature: string, blockTime: string): NewReceipt {
  return {
    owner_wallet: owner,
    source: "imported",
    tx_signature: signature,
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amount_raw: "1200000000",
    decimals: 6,
    payer_wallet: "payer-wallet-for-the-check",
    block_time: blockTime,
    memo: "Acme Labs: web app development",
    category: null,
    description: null,
    contact_id: null,
    invoice_id: null,
    fx_rule: null,
    fx_date: null,
    fx_rate: null,
    amount_brl: null,
    receipt_json: null,
    receipt_hash: null,
    seal_signature: null,
  };
}

/** Exercises every method of the Store interface, the way the app does. */
async function runStoreChecks(store: Store, owner: string) {
  // Profiles
  const profile = await store.ensureProfile(owner);
  check("profile is created on first sign-in", profile.wallet === owner && profile.fx_rule === "ptax_buy");
  check("signing in again does not fail or reset it", (await store.ensureProfile(owner)).wallet === owner);
  check("the rate rule can be changed", (await store.updateProfile(owner, { fx_rule: "ptax_sell" })).fx_rule === "ptax_sell");

  // Contacts
  const contact = await store.upsertContact(owner, { wallet: "payer-wallet-for-the-check", name: "Acme", kind: "client" });
  const renamed = await store.upsertContact(owner, { wallet: "payer-wallet-for-the-check", name: "Acme Labs", kind: "client" });
  const contacts = await store.listContacts(owner);
  check("naming the same payer twice updates the contact", contacts.length === 1 && renamed.id === contact.id && contacts[0].name === "Acme Labs");

  // Receipts: the idempotent insert is what makes "import" safe to repeat.
  const first = await store.insertReceipts([
    receipt(owner, "check-sig-1", "2026-10-05T14:00:00.000Z"),
    receipt(owner, "check-sig-2", "2026-10-07T14:03:11.000Z"),
  ]);
  check("two new receipts are inserted", first.length === 2);
  const second = await store.insertReceipts([
    receipt(owner, "check-sig-1", "2026-10-05T14:00:00.000Z"),
    receipt(owner, "check-sig-3", "2026-10-06T09:00:00.000Z"),
  ]);
  check("importing again inserts only what is new", second.length === 1 && second[0]?.tx_signature === "check-sig-3", `${second.length} inserted`);

  const listed = await store.listReceipts(owner);
  check(
    "receipts come back newest first",
    listed.map((row) => row.tx_signature).join(",") === "check-sig-2,check-sig-3,check-sig-1",
    listed.map((row) => row.tx_signature).join(","),
  );
  check("the amount in base units survives as text", listed[0]?.amount_raw === "1200000000" && listed[0]?.decimals === 6);
  check(
    "the payment time survives",
    new Date(listed[0]?.block_time ?? 0).toISOString() === "2026-10-07T14:03:11.000Z",
    String(listed[0]?.block_time),
  );

  const target = listed[0];
  const updated = await store.updateReceipt(target.id, {
    category: "service",
    description: "Web app development, September",
    contact_id: contact.id,
    fx_rule: "ptax_buy",
    fx_date: "2026-10-07",
    fx_rate: "5.4321",
    amount_brl: "6518.52",
  });
  check("classification is saved", updated.category === "service" && updated.contact_id === contact.id);
  // If these came back as JavaScript numbers, money would be passing through floats.
  check(
    "rate and BRL value come back as exact strings, not floats",
    updated.fx_rate === "5.4321" && updated.amount_brl === "6518.52" && updated.fx_date === "2026-10-07",
    `fx_rate=${JSON.stringify(updated.fx_rate)} amount_brl=${JSON.stringify(updated.amount_brl)} fx_date=${JSON.stringify(updated.fx_date)}`,
  );
  const fetched = await store.getReceipt(target.id);
  check("a receipt can be read by id", fetched?.amount_brl === "6518.52");
  check("an unknown id returns nothing", (await store.getReceipt(randomUUID())) === null);

  // Invoices
  const invoice = await store.insertInvoice({
    number: "INV-0001",
    owner_wallet: owner,
    client_name: "Acme Labs",
    client_email: null,
    description: "October retainer",
    amount_raw: "2500000000",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    decimals: 6,
    reference: `check-reference-${randomUUID()}`,
    invoice_json: "{}",
    invoice_hash: "0".repeat(64),
  });
  check("an invoice is created as pending", invoice.status === "pending" && invoice.paid_signature === null);
  const paid = await store.markInvoicePaid(invoice.id, "check-payment-sig", "2026-10-08T12:00:00.000Z");
  check("an invoice can be marked paid", paid.status === "paid" && paid.paid_signature === "check-payment-sig");
  check("invoices are listed by owner", (await store.listInvoices(owner)).length === 1 && (await store.getInvoice(invoice.id))?.number === "INV-0001");

  // Exchange-rate cache
  await store.saveFxRate({ requested_date: SENTINEL_DATE, rule: "ptax_buy", quote_date: "1990-01-01", rate: "5.2232" });
  await store.saveFxRate({ requested_date: SENTINEL_DATE, rule: "ptax_buy", quote_date: "1990-01-01", rate: "5.2233" });
  const rate = await store.getFxRate(SENTINEL_DATE, "ptax_buy");
  check("a cached rate is saved, overwritten and read back as text", rate?.rate === "5.2233" && rate.quote_date === "1990-01-01", JSON.stringify(rate));
  check("a rate that was never cached returns nothing", (await store.getFxRate(SENTINEL_DATE, "ptax_sell")) === null);

  // Simulated payouts
  const payout = await store.insertPayout({
    owner_wallet: owner,
    amount_raw: "1000000000",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amount_brl: "4963.72",
    pix_key: "ana@example.com",
    provider: "simulated_pix",
    status: "simulated",
  });
  check("a simulated payout is recorded", payout.amount_brl === "4963.72" && (await store.listPayouts(owner)).length === 1);
}

async function main() {
  loadEnv();
  const owner = `recebi-check-${randomUUID()}`;

  if (process.argv.includes("--dry-run")) {
    process.env.RECEBI_MOCK_PERSIST = "off";
    const { FileStore } = await import("../lib/db/file-store");
    console.log("Dry run: checking the checks against the in-memory store. Supabase is not contacted.\n");
    await runStoreChecks(new FileStore(), owner);
    return;
  }

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    stop(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are empty in .env.local.\n" +
        "In the Supabase dashboard: Project Settings > API (or API Keys). Copy the Project URL and the\n" +
        "service_role key (called \"secret key\" in newer projects) into .env.local, then run this again.",
    );
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    console.log(`Note: SUPABASE_URL does not look like https://<project>.supabase.co. Continuing anyway.`);
  }
  if (describeKey(key) === "anon") {
    stop(
      "SUPABASE_SERVICE_ROLE_KEY holds the PUBLIC key (anon / publishable).\n" +
        "Recebi needs the service_role key (\"secret key\"), from the same page in the dashboard.",
    );
  }

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Can we connect, and has the schema been run?
  const missing: string[] = [];
  for (const table of TABLES) {
    const { error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) {
      if (/fetch failed|ENOTFOUND|getaddrinfo/i.test(error.message)) {
        stop(`Could not reach ${url}. Check SUPABASE_URL and your internet connection.\n(${error.message})`);
      }
      if (/Invalid API key|JWT|Unauthorized|No API key/i.test(error.message)) {
        stop(`Supabase rejected the key: ${error.message}\nCopy SUPABASE_SERVICE_ROLE_KEY again; it must be complete, with no spaces or quotes.`);
      }
      missing.push(`${table} (${error.message})`);
    }
  }
  check("connected, and all 6 tables exist", missing.length === 0, missing.join("; "));
  if (missing.length > 0) {
    stop("The tables are missing. In the Supabase dashboard open SQL Editor, paste the whole of\nsupabase/schema.sql, click Run, and run this again.");
  }

  // 2. Every database operation the app performs.
  const { SupabaseStore } = await import("../lib/db/supabase-store");
  try {
    await runStoreChecks(new SupabaseStore(url, key), owner);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL a database operation threw: ${message}`);
    if (/row-level security/i.test(message)) {
      console.log("     That is Row Level Security refusing the write: the key in .env.local is not the service_role key.");
    }
  } finally {
    // 3. Remove everything this script created.
    for (const table of ["receipts", "invoices", "payouts", "contacts"]) {
      await client.from(table).delete().eq("owner_wallet", owner);
    }
    await client.from("profiles").delete().eq("wallet", owner);
    await client.from("fx_rates").delete().eq("requested_date", SENTINEL_DATE);
    const { count } = await client.from("receipts").select("*", { count: "exact", head: true }).eq("owner_wallet", owner);
    check("test rows were removed", count === 0);
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\nThe check crashed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
