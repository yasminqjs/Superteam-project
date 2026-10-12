// HTTP smoke test for LIVE mode. Start the app with `npm run dev:live`, then:
//   node scripts/smoke-live.mjs [http://localhost:3000]
//
// It signs in with a throwaway wallet (login is a signed message, so no wallet
// extension is needed) and uses the real Supabase project, the real PTAX API
// and the devnet RPC. It cannot seal or pay: that needs devnet SOL (see
// `npm run check:live`). Everything it writes is deleted at the end.
import { Keypair } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import nacl from "tweetnacl";

process.loadEnvFile(".env.local");
const BASE = process.argv[2] ?? "http://localhost:3000";

const wallet = Keypair.generate();
const address = wallet.publicKey.toBase58();
const cookies = new Map();
let failures = 0;

function check(label, condition, detail = "") {
  if (!condition) failures++;
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
}

async function call(method, path, body, { auth = true } = {}) {
  const headers = {};
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
const json = async (method, path, body, options) => {
  const response = await call(method, path, body, options);
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

async function cleanUp() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const table of ["receipts", "invoices", "payouts", "contacts"]) {
    await db.from(table).delete().eq("owner_wallet", address);
  }
  await db.from("profiles").delete().eq("wallet", address);
  const { count } = await db.from("profiles").select("*", { count: "exact", head: true }).eq("wallet", address);
  check("test rows were removed from Supabase", count === 0);
}

try {
  const mock = await json("POST", "/api/mock/reset");
  if (mock.status !== 404) {
    console.error("This server is in MOCK mode. Start it with `npm run dev:live` and run this again.");
    process.exit(1);
  }
  check("mock routes do not exist in live mode", true);

  // --- Login ------------------------------------------------------------------
  const nonce = await json("POST", "/api/auth/nonce", { wallet: address });
  check("login message issued", nonce.status === 200 && nonce.body.message?.includes("solana:devnet"), JSON.stringify(nonce.body).slice(0, 140));
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.body.message ?? ""), wallet.secretKey));
  const login = await json("POST", "/api/auth/verify", { wallet: address, signature });
  check("signed in, profile created in Supabase", login.status === 200 && login.body.fx_rule === "ptax_buy", JSON.stringify(login.body).slice(0, 140));

  // --- Receipts and import ----------------------------------------------------
  const list = await json("GET", "/api/receipts");
  check("receipts load from Supabase (empty for a new wallet)", list.status === 200 && list.body.receipts?.length === 0, JSON.stringify(list.body).slice(0, 140));
  const imported = await json("POST", "/api/receipts/import");
  check("import scans devnet (nothing to find for a new wallet)", imported.status === 200 && imported.body.imported === 0, JSON.stringify(imported.body).slice(0, 140));

  // --- Profile persists -------------------------------------------------------
  await json("PATCH", "/api/profile", { fx_rule: "ptax_sell" });
  check("the rate rule is stored in Supabase", (await json("GET", "/api/auth/me")).body.fx_rule === "ptax_sell");

  // --- Invoices ---------------------------------------------------------------
  const mint = JSON.parse(process.env.NEXT_PUBLIC_STABLE_MINTS)[0].mint;
  const first = await json("POST", "/api/invoices", { client_name: "Smoke Test Client", description: "Live smoke test", amount: "12.5", mint });
  const second = await json("POST", "/api/invoices", { client_name: "Smoke Test Client", description: "Second", amount: "1", mint });
  check("invoices are numbered in sequence", first.body.invoice?.number === "INV-0001" && second.body.invoice?.number === "INV-0002", JSON.stringify(first.body).slice(0, 140));
  check("the Solana Pay link targets devnet's token", first.body.invoice?.solana_pay_url?.startsWith(`solana:${address}?amount=12.5&spl-token=${mint}`));
  const status = await json("GET", `/api/invoices/${first.body.invoice?.id}/status`, undefined, { auth: false });
  check("the public pay page looks for the payment on devnet", status.status === 200 && status.body.invoice?.status === "pending", JSON.stringify(status.body).slice(0, 140));
  check("another visitor cannot list this wallet's invoices", (await json("GET", "/api/invoices", undefined, { auth: false })).status === 401);

  // --- PTAX and simulated payout ------------------------------------------------
  const quote = await json("POST", "/api/payouts/quote", { mint, amount: "1000" });
  check("payout quote uses the real PTAX sell rate", quote.status === 200 && /^\d\.\d{4}$/.test(quote.body.quote?.ptax_rate ?? ""), `PTAX sell ${quote.body.quote?.ptax_rate} on ${quote.body.quote?.ptax_date}`);
  const payout = await json("POST", "/api/payouts", { mint, amount: "1000", pix_key: "smoke@example.com" });
  check("simulated payout stored in Supabase", payout.body.payout?.status === "simulated" && (await json("GET", "/api/payouts")).body.payouts?.length === 1);

  // --- Reports ----------------------------------------------------------------
  const report = await json("GET", "/api/reports");
  check("monthly report builds", report.status === 200 && Array.isArray(report.body.report?.totals));
  const csv = await call("GET", "/api/reports/csv");
  check("CSV export", csv.status === 200 && (await csv.text()).includes("date_brt,tx_signature"));
  const pdf = await call("GET", "/api/reports/pdf");
  check("summary PDF", pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");

  await json("POST", "/api/auth/logout");
  check("logout ends the session", (await json("GET", "/api/receipts")).status === 401);
} catch (error) {
  failures++;
  console.log(`FAIL the smoke test crashed: ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanUp();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
