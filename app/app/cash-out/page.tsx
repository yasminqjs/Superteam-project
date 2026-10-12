"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Badge, Button, Card, Eyebrow, Field, Notice, PageTitle, inputClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { STABLE_MINTS, findStableMint } from "@/lib/config/mints";
import type { Payout } from "@/lib/db/types";
import { formatBRL, formatBrazilian, formatTokenAmount } from "@/lib/money/units";
import type { PayoutQuote } from "@/lib/services/payouts";
import { brtDateTime } from "@/lib/time";

export default function CashOutPage() {
  const { connection } = useConnection();
  const { session, can } = useSession();
  const wallet = session.status === "signed_in" ? session.wallet : null;

  const [mint, setMint] = useState(STABLE_MINTS[0].mint);
  const [amount, setAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<PayoutQuote | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [busy, setBusy] = useState<"quote" | "payout" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPayouts = useCallback(
    () =>
      api<{ payouts: Payout[] }>("/api/payouts")
        .then((loaded) => setPayouts(loaded.payouts))
        .catch((caught) => setError(errorMessage(caught))),
    [],
  );

  useEffect(() => {
    void loadPayouts();
  }, [loadPayouts]);

  // The wallet's real token balance, read from the chain. Display only.
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    connection
      .getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(mint) })
      .then(({ value }) => {
        if (cancelled) return;
        const total = value.reduce(
          (sum, { account }) => sum + BigInt(account.data.parsed.info.tokenAmount.amount),
          0n,
        );
        setBalance(total);
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, wallet, mint]);

  async function getQuote(event: FormEvent) {
    event.preventDefault();
    setBusy("quote");
    setError(null);
    setQuote(null);
    try {
      setQuote((await api<{ quote: PayoutQuote }>("/api/payouts/quote", { json: { mint, amount } })).quote);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function requestPayout() {
    setBusy("payout");
    setError(null);
    try {
      await api("/api/payouts", { json: { mint, amount, pix_key: pixKey } });
      setQuote(null);
      setAmount("");
      await loadPayouts();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const token = findStableMint(mint)!;

  return (
    <div>
      <PageTitle title="Cash out" />

      <div
        role="note"
        className="mt-6 rounded-lg border-2 border-dashed border-ink/40 bg-surface px-4 py-3 text-sm font-medium"
      >
        Simulated. In production, payouts are executed by a Central Bank–authorized partner.
        <span className="block font-normal text-muted">
          Nothing on this page moves tokens or sends a Pix. It shows how a regulated partner would
          plug in.
        </span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <Eyebrow>Pix payout</Eyebrow>
          <form onSubmit={getQuote} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Field
                label="Amount"
                hint={balance === null ? undefined : `Balance: ${formatTokenAmount(balance, token.decimals)}`}
              >
                <input
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setQuote(null);
                  }}
                  inputMode="decimal"
                  placeholder="500.00"
                  required
                  className={`${inputClass} tabular-nums`}
                />
              </Field>
              <Field label="Token">
                <select
                  value={mint}
                  onChange={(event) => {
                    setMint(event.target.value);
                    setQuote(null);
                  }}
                  className={inputClass}
                >
                  {STABLE_MINTS.map((option) => (
                    <option key={option.mint} value={option.mint}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Pix key" hint="CPF, e-mail, phone or random key">
              <input
                value={pixKey}
                onChange={(event) => setPixKey(event.target.value)}
                placeholder="ana@example.com"
                maxLength={140}
                className={inputClass}
              />
            </Field>
            {error && <Notice>{error}</Notice>}
            <Button type="submit" variant="secondary" busy={busy === "quote"} disabled={!can("write")}>
              Get quote
            </Button>
          </form>
        </Card>

        <Card>
          <Eyebrow>Quote</Eyebrow>
          {!quote ? (
            <p className="mt-4 text-sm text-muted">
              Enter an amount to see how much would arrive in reais, and how that number is built.
            </p>
          ) : (
            <>
              <p className="mt-3 text-4xl font-semibold tabular-nums">{formatBRL(quote.amount_brl)}</p>
              <p className="mt-1 text-sm text-muted">
                for {quote.amount} {quote.symbol}
              </p>
              <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm tabular-nums">
                <QuoteRow label={`PTAX sell · ${quote.ptax_date}`} value={`R$ ${formatBrazilian(quote.ptax_rate, 4)}`} />
                <QuoteRow label="Partner spread" value={`${formatBrazilian((quote.spread_bps / 100).toFixed(2))}%`} />
                <QuoteRow label="Effective rate" value={`R$ ${formatBrazilian(quote.effective_rate, 4)}`} />
              </dl>
              <Button
                className="mt-5"
                onClick={requestPayout}
                busy={busy === "payout"}
                disabled={!pixKey.trim() || !can("owner")}
              >
                Simulate payout
              </Button>
              {!can("owner") ? (
                <p className="mt-2 text-sm text-muted">
                  Only the company&apos;s own wallet can cash out. Your role can prepare the quote.
                </p>
              ) : (
                !pixKey.trim() && <p className="mt-2 text-sm text-muted">Enter a Pix key first.</p>
              )}
            </>
          )}
        </Card>
      </div>

      {payouts.length > 0 && (
        <section aria-label="Simulated payouts" className="mt-10">
          <h2 className="font-display text-3xl">Simulated payouts</h2>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {payouts.map((payout) => {
              const paidToken = findStableMint(payout.mint);
              return (
                <li key={payout.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[9.5rem_1fr_auto_auto] sm:px-3">
                  <span className="text-sm tabular-nums text-muted">{brtDateTime(new Date(payout.created_at))}</span>
                  <span className="order-first col-span-2 truncate sm:order-none sm:col-span-1">
                    Pix to <span className="font-medium">{payout.pix_key}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-medium">{formatBRL(payout.amount_brl)}</span>
                    <span className="block text-sm text-muted">
                      {formatTokenAmount(BigInt(payout.amount_raw), paidToken?.decimals ?? 6)} {paidToken?.symbol}
                    </span>
                  </span>
                  <Badge>Simulated</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
