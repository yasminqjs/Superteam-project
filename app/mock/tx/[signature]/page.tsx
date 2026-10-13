"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Card, Eyebrow, Loading, Notice } from "@/components/ui";
import { errorMessage } from "@/lib/api-client";
import { IS_MOCK } from "@/lib/mode";
import { formatUnits } from "@/lib/money/units";
import { extractMemos, transactionSigners, type ParsedTransactionLike } from "@/lib/solana/parse";
import { brtDateTime } from "@/lib/time";

type TokenBalances = NonNullable<NonNullable<ParsedTransactionLike["meta"]>["postTokenBalances"]>;

/** Net change per wallet across every mint in the transaction. */
function balanceChanges(tx: ParsedTransactionLike) {
  const changes = new Map<string, { owner: string; mint: string; delta: bigint; decimals: number }>();
  const apply = (balances: TokenBalances | null | undefined, sign: 1n | -1n) => {
    for (const balance of balances ?? []) {
      if (!balance.owner) continue;
      const key = `${balance.owner}|${balance.mint}`;
      const entry = changes.get(key) ?? {
        owner: balance.owner,
        mint: balance.mint,
        delta: 0n,
        decimals: balance.uiTokenAmount.decimals,
      };
      entry.delta += BigInt(balance.uiTokenAmount.amount) * sign;
      changes.set(key, entry);
    }
  };
  apply(tx.meta?.postTokenBalances, 1n);
  apply(tx.meta?.preTokenBalances, -1n);
  return [...changes.values()].filter((entry) => entry.delta !== 0n);
}

/**
 * Mock mode's stand-in for Solana Explorer: shows one transaction of the mock
 * ledger, so "look at the memo on the explorer" still works in a rehearsal.
 */
export default function MockTransactionPage() {
  const { signature } = useParams<{ signature: string }>();
  const { connection } = useConnection();
  const [tx, setTx] = useState<ParsedTransactionLike | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_MOCK) return;
    let cancelled = false;
    connection
      .getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
      .then((loaded) => {
        if (!cancelled) setTx(loaded);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [connection, signature]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="font-display text-4xl tracking-tight">Mock ledger transaction</h1>
        <p className="mt-2 text-sm text-muted">
          This transaction exists only in Yvex Chain&apos;s simulated ledger. It is not on Solana.
        </p>

        <div className="mt-8 space-y-6">
          {!IS_MOCK && <Notice>This page only exists in mock mode.</Notice>}
          {error && <Notice>{error}</Notice>}
          {IS_MOCK && tx === undefined && !error && <Loading />}
          {tx === null && <Notice>No transaction with this signature in the mock ledger.</Notice>}
          {tx && (
            <>
              <Card>
                <Eyebrow>Signature</Eyebrow>
                <p className="mt-2 break-all font-mono text-xs">{signature}</p>
                <dl className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
                  <div>
                    <dt className="text-muted">Time</dt>
                    <dd className="tabular-nums">
                      {tx.blockTime ? `${brtDateTime(new Date(tx.blockTime * 1000))} Brasília time` : "Unknown"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Signed by</dt>
                    {transactionSigners(tx).map((signer) => (
                      <dd key={signer} className="break-all font-mono text-xs">
                        {signer}
                      </dd>
                    ))}
                  </div>
                  <div>
                    <dt className="text-muted">Memo</dt>
                    {extractMemos(tx).length === 0 && <dd>None</dd>}
                    {extractMemos(tx).map((memo) => (
                      <dd key={memo} className="break-all font-mono text-xs">
                        {memo}
                      </dd>
                    ))}
                  </div>
                  <div>
                    <dt className="text-muted">Token balance changes</dt>
                    {balanceChanges(tx).length === 0 && <dd>None</dd>}
                    {balanceChanges(tx).map((change) => (
                      <dd key={`${change.owner}-${change.mint}`} className="font-mono text-xs tabular-nums">
                        {change.delta > 0n ? "+" : ""}
                        {formatUnits(change.delta, change.decimals, { minFractionDigits: 2 })}{" "}
                        <span className="break-all text-muted">{change.owner}</span>
                      </dd>
                    ))}
                  </div>
                </dl>
              </Card>
              <details className="rounded-lg border border-line bg-surface p-5 text-sm">
                <summary className="cursor-pointer font-medium">Raw transaction (jsonParsed)</summary>
                <pre className="mt-4 overflow-x-auto text-xs leading-5">{JSON.stringify(tx, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
