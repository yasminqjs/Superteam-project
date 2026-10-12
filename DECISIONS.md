# Decisions

Short log of technical choices and why we made them. Newest phase last.

## Phase 0: setup

**Next.js 16 with Cache Components turned off.** `create-next-app` now enables
`cacheComponents` and `partialPrefetching` by default. With them on, any page
that reads a cookie or a route parameter must sit inside `<Suspense>` or use
`"use cache"`, or the build fails. Almost every Recebi page is per-user and
wallet-driven, so that buys us nothing and adds a class of errors. We use the
previous rendering model, which Next.js 16 still supports and documents.

**No `src/` directory.** Routes live in `app/`, logic in `lib/`, tests in
`test/`. Note that the dashboard route `/app` is the folder `app/app/`.

**Wallets are discovered through the Wallet Standard.** We pass an empty adapter
list to `WalletProvider`; Phantom, Solflare and Backpack register themselves.
This avoids `@solana/wallet-adapter-wallets`, which installs dozens of wallet
SDKs we do not need and is a common source of build problems.

**Our own connect button instead of `WalletMultiButton`.** It is about 40 lines,
matches the product's look, and renders the same HTML on the server and on the
client, so there is no hydration mismatch to work around. The wallet picker
modal still comes from `@solana/wallet-adapter-react-ui`.

**Devnet is enforced twice.** `lib/solana/cluster.ts` throws at startup if
`NEXT_PUBLIC_SOLANA_CLUSTER` is not `devnet`. Because an RPC URL does not prove
which network is behind it, we also compare the node's genesis hash with
devnet's and show the result next to the connected wallet.

**Token amounts are `bigint` in base units.** `formatUnits` builds the decimal
string by slicing digits, so no amount ever passes through a float. When it has
to shorten a number for display it truncates rather than rounds, so the UI never
shows more than the wallet holds. TypeScript targets ES2020 for `bigint`
literals; this only affects type-checking, not the browser bundle.

**Tests cover pure logic only.** Vitest runs in the `node` environment with no
jsdom or React Testing Library. The value of this product is in parsing,
hashing and currency maths, and those are plain functions.

**Light theme only, one accent colour.** Green is reserved for the Verified
seal, links and success states; buttons and text are ink. Red appears only for
Mismatch and errors. A single theme keeps the demo videos consistent.

## Two modes: live and mock

**Mock mode fakes the transports, not the logic.** `NEXT_PUBLIC_RECEBI_MODE=mock`
swaps exactly three things: the RPC (a small in-memory node in `lib/mock/`), the
wallet (a built-in keypair behind the normal wallet-adapter interface) and the
database (a JSON file behind the same `Store` interface as Supabase), plus
synthetic PTAX rates. The mock node speaks JSON-RPC, so the app keeps using
`@solana/web3.js`'s `Connection` everywhere and import, hashing, sealing and
verification run the very same code in both modes. That is also what makes the
whole flow testable in Vitest and in a headless browser, with no network.

**The mock node executes real signed transactions.** It checks ed25519
signatures and runs the Token, Associated Token Account and Memo instructions
Recebi builds, then stores the result in the shape of a real `getTransaction`
answer. Any method it does not implement returns "method not found" instead of
something made up.

**A mock result must never pass for a real one.** Mock receipts carry
`"network": "recebi:mock"` and the verifier rejects a receipt whose network is
not the one it is connected to. Every page shows a banner, PDFs carry a red
notice, and user-facing sentences say "the mock ledger (not Solana)". Mock
routes answer 404 in live mode. The demo keys are derived from public labels
and are only ever registered in mock mode.

## Phases 1 to 5

**Use cases live in `lib/services/` and receive their dependencies.** Each takes
`{ store, connection, fetchPtax, now }` as an argument. Route handlers are thin
wrappers. Pages are client components that call the API, because nearly every
screen depends on the wallet, which only exists in the browser.

**Login keeps no state on the server.** The nonce travels inside a signed,
5-minute, `httpOnly` challenge cookie; the session is a 7-day signed cookie.
Trade-off: a session cannot be revoked before it expires. Fine for an MVP.

**The login message is plain text, deliberately not "Sign-In with Solana".**
Phantom recognises SIWS messages by their first line and validates them
strictly (format, domain, URI) before prompting; our first version looked like
one without being one, and Phantom refused it with "cannot be shown due to
invalid formatting". A plain message is just displayed. Adopting real SIWS
(the wallet checks the domain, which helps against phishing) is a possible
next step, once it can be tested against the wallets we care about.

**We send transactions ourselves.** The wallet only signs (`signTransaction`);
the app sends through its own RPC and confirms by polling
`getSignatureStatuses`. A transaction can therefore only reach the network the
app is configured for, whatever network the wallet is on, and confirmation does
not depend on WebSockets.

**Import trusts balances, not instructions.** A payment is any transaction where
the wallet's balance of an accepted mint went up, according to
`pre/postTokenBalances`. That covers plain transfers, `transferChecked`, and
transfers made through other programs. The payer is the wallet whose balance
fell the most, which is not always the fee payer. Batches are 5 transactions:
measured, the public devnet RPC accepts 5 and rejects 10.

**Import never overwrites.** New rows are inserted with "on conflict do
nothing" on `(owner_wallet, tx_signature, mint)`, so re-importing cannot undo a
classification.

**Dates are Brasília time; money is text.** The PTAX date of a payment is its
calendar date in `America/Sao_Paulo`. BRL values and rates are decimal strings
end to end (`decimal.js` for arithmetic, `::text` casts when reading Postgres).
A fallback rate for *today* is not cached, because today's quote may still be
published.

**Sealing is prepare, sign, confirm.** `prepare` freezes the receipt into
canonical JSON. The browser recomputes the hash before asking the wallet to
sign. `confirm` runs the public `verifyReceipt` on the server and only then
stores the signature, so the database cannot hold a seal that fails
verification. A sealed receipt is immutable.

**A network failure is never a verdict.** If the RPC cannot be reached or
rate-limits us, `verifyReceipt` retries and then throws `RpcUnavailableError`;
it does not report "transaction not found". The verify page shows that as a
network problem. Found while testing on the public devnet RPC, where a rate
limit made a valid receipt look like a Mismatch.

**The payer can be unknown.** If no wallet's balance of the mint went down in
the transaction (for example, the sender was minted the tokens in that same
transaction), the payment is imported with `payer_wallet` empty and cannot be
linked to a contact. Our first demo seed did exactly that by accident; it now
funds the payers in a separate transaction. A sender who swaps and pays in one
transaction would hit the same limit: a known gap.

**The receipt does not carry token decimals.** Verification takes them from the
payment transaction itself and compares the formatted amount with the receipt.

**An invoice is paid only by an exact match.** The reference key finds
candidate transactions; one settles the invoice only if it credited the exact
amount of the right mint to the issuer and carries the invoice hash in its
memo. The oldest valid payment wins, and settling is idempotent.

**CSV is comma-separated UTF-8 with a byte order mark.** Free-text cells that
start with `=`, `+`, `-` or `@` are prefixed with `'`, because memos and names
come from other people and spreadsheets execute formulas. Known gap: Excel in
a Brazilian locale expects `;` and will need "Data > From Text/CSV".

**PDFs use `@react-pdf/renderer` with the built-in Helvetica.** Nothing is
downloaded at render time. Hyphenation is disabled so signatures are never
printed with an added hyphen.

**The payout quote rounds down.** PTAX sell minus a configurable spread
(`PAYOUT_SPREAD_BPS`), truncated to centavos: a quote must not promise more
than would arrive. It is simulated; see `lib/services/payouts.ts`.

## Company accounts

**A company is an account, not a new kind of thing.** Every row already
belonged to a wallet (`owner_wallet`), and the receiving wallet is what the
chain and the receipts talk about. So a company account is that same wallet's
account plus a row in `organizations` (name, tax ID) and rows in
`organization_members`. No table changed, no data moved, and a freelancer who
later hires an accountant keeps every receipt they already sealed.

**Members are wallets, and the owner is the account's own wallet.** Adding a
person means typing their address and a role. Nobody receives an invitation
e-mail and nobody shares a key. The price is that an accountant needs a wallet
to sign in; e-mail sign-in is on the roadmap.

**Three roles, one table.** `lib/team.ts` says what Owner, Finance and
Read-only may do. Pages read it to hide what a role cannot use; every private
route calls `requireActor(store, permission)`, which is where it is enforced.

**Sealing and cashing out belong to the owner and cannot be delegated.** A seal
is checked by anyone against the recipient's signature, so only the receiving
wallet can make one; giving Finance a "seal" button would produce seals that
fail verification. Cash-out moves the company's money, so it follows the same
rule. Finance can prepare the quote.

**The selected account is a cookie, and the cookie is only a wish.** It holds
the address of the account the signer wants to act on. Each request looks the
membership up again, so removing a member takes effect on their next click. If
the membership is gone the request fails with a 403: it never falls back to the
signer's own account, because a write meant for the company must not land
somewhere else. Only `/api/auth/me` falls back, and it clears the cookie.

**The audit trail stores the actor's name at the time.** Reading it later from
the team table would turn a removed member into an address. Writing the trail
is best-effort: the action it describes has already happened, so a failure to
record it is logged and does not undo the action.

**Company identity goes into the invoice, not into the receipt.** A company's
invoices carry `issuer_name` and `issuer_tax_id` inside the hashed document, so
the payer's own transaction commits to them. Personal invoices omit both fields
and hash exactly as before. The receipt format (`recebi.receipt` v1) did not
change: anything sealed earlier still verifies.

**The new tables are optional at runtime.** A database created before them
keeps running everything else; the team page says to run `supabase/schema.sql`
again, and the schema ends with `notify pgrst, 'reload schema'` so the API sees
the tables at once.

**Mock mode can be three people.** The demo wallet can switch between Ana (the
company wallet), Bia (Finance) and Caio (Read-only) from the mock banner, so
one browser can show a company from all three sides.

## Dependencies

**Known `npm audit` findings, left as they are.** All of them come from
transitive dependencies of `@solana/web3.js` v1 and the wallet adapter, have no
fix available, and are outside the code we run: `braces` belongs to React
Native's Metro bundler (pulled in by the mobile wallet adapter), `stream-json`
is used by `jayson`'s server-side stream parser (we only use its client), and
the `uuid` advisory affects v3/v5/v6 with a caller-supplied buffer (`jayson`
only calls v4). We did not run `npm audit fix --force`, which would break the
Solana stack.
