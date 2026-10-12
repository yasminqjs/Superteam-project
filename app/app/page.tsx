"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Button, ButtonLink, Card, Eyebrow, Loading, Notice, PageTitle, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import type { FxRule } from "@/lib/db/types";
import { shortAddress } from "@/lib/format";
import { CATEGORY_LABELS, FX_RULE_LABELS } from "@/lib/labels";
import { formatBRL } from "@/lib/money/units";
import type { ReceiptView } from "@/lib/services/receipts";
import type { MonthlyReport } from "@/lib/services/reports";

interface DashboardData {
  receipts: ReceiptView[];
  report: MonthlyReport;
}

async function loadDashboard(): Promise<DashboardData> {
  const [{ receipts }, { report }] = await Promise.all([
    api<{ receipts: ReceiptView[] }>("/api/receipts"),
    api<{ report: MonthlyReport }>("/api/reports"),
  ]);
  return { receipts, report };
}

export default function DashboardPage() {
  const { session, setFxRule, can } = useSession();
  const canWrite = can("write");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [changingRule, setChangingRule] = useState(false);

  const refresh = useCallback(
    () =>
      loadDashboard()
        .then(setData)
        .catch((caught) => setError(errorMessage(caught))),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function importFromWallet() {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ imported: number; scanned: number }>("/api/receipts/import", {
        method: "POST",
      });
      setNotice(
        result.imported === 0
          ? `Nothing new. ${result.scanned} transactions checked.`
          : `Imported ${result.imported} new payment${result.imported === 1 ? "" : "s"} from ${result.scanned} transactions.`,
      );
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  async function changeRule(rule: FxRule) {
    setChangingRule(true);
    setError(null);
    try {
      await api("/api/profile", { method: "PATCH", json: { fx_rule: rule } });
      setFxRule(rule);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChangingRule(false);
    }
  }

  const fxRule = session.status === "signed_in" ? session.fxRule : "ptax_buy";
  const unsealed = data?.receipts.filter((receipt) => receipt.status !== "sealed").length ?? 0;

  return (
    <div>
      <PageTitle title="Payments">
        {canWrite && (
          <Button onClick={importFromWallet} busy={importing}>
            Import from wallet
          </Button>
        )}
      </PageTitle>

      <div className="mt-6 space-y-3">
        {error && <Notice>{error}</Notice>}
        {notice && <Notice tone="accent">{notice}</Notice>}
      </div>

      {!data && !error && <Loading />}
      {data && (
        <>
          <section aria-label="This month" className="mt-8 grid gap-4 sm:grid-cols-3">
            <Card>
              <Eyebrow>Income in {data.report.month}</Eyebrow>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {formatBRL(data.report.total_brl_excluding_own)}
              </p>
              <p className="mt-1 text-sm text-muted">Excludes transfers between your own wallets</p>
            </Card>
            <Card>
              <Eyebrow>Received in {data.report.month}</Eyebrow>
              <div className="mt-2 space-y-1 text-sm tabular-nums">
                {data.report.totals.length === 0 && <p className="text-muted">No payments this month</p>}
                {data.report.totals.map((total) => (
                  <p key={`${total.category}-${total.symbol}`} className="flex justify-between gap-3">
                    <span className="text-muted">{CATEGORY_LABELS[total.category]}</span>
                    <span className="font-medium">
                      {total.amount} {total.symbol}
                    </span>
                  </p>
                ))}
              </div>
            </Card>
            <Card>
              <Eyebrow>BRL valuation rule</Eyebrow>
              <select
                aria-label="BRL valuation rule"
                value={fxRule}
                disabled={changingRule || !canWrite}
                onChange={(event) => changeRule(event.target.value as FxRule)}
                className="mt-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                {(Object.keys(FX_RULE_LABELS) as FxRule[]).map((rule) => (
                  <option key={rule} value={rule}>
                    {FX_RULE_LABELS[rule]}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm text-muted">
                {unsealed} unsealed payment{unsealed === 1 ? "" : "s"} follow this rule. Sealed receipts
                never change.
              </p>
            </Card>
          </section>

          <div className="mt-6 flex flex-wrap gap-3">
            {canWrite && (
              <ButtonLink href="/app/invoices/new" variant="secondary">
                New invoice
              </ButtonLink>
            )}
            <ButtonLink href="/app/reports" variant="secondary">
              Monthly report
            </ButtonLink>
            <ButtonLink href="/app/cash-out" variant="secondary">
              Cash out
            </ButtonLink>
          </div>

          <section aria-label="All payments" className="mt-10">
            {data.receipts.length === 0 ? (
              <Card className="text-center">
                <p className="font-display text-2xl">No payments yet</p>
                <p className="mt-2 text-sm text-muted">
                  Click <span className="font-medium text-ink">Import from wallet</span> to read your
                  wallet&apos;s history and list every incoming stablecoin payment.
                </p>
              </Card>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {data.receipts.map((receipt) => (
                  <li key={receipt.id}>
                    <ReceiptRow receipt={receipt} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ReceiptRow({ receipt }: { receipt: ReceiptView }) {
  const from = receipt.contact?.name ?? (receipt.payer_wallet ? shortAddress(receipt.payer_wallet) : "Unknown payer");
  return (
    <Link
      href={`/app/receipts/${receipt.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-4 hover:bg-surface sm:grid-cols-[9.5rem_1fr_7rem_auto_7.5rem] sm:px-3"
    >
      <span className="order-3 text-sm tabular-nums text-muted sm:order-none">{receipt.block_time_brt}</span>
      <span className="order-1 min-w-0 sm:order-none">
        <span className={`block truncate font-medium ${receipt.contact ? "" : "font-mono text-sm"}`}>{from}</span>
        {(receipt.description || receipt.memo) && (
          <span className="block truncate text-sm text-muted">{receipt.description ?? receipt.memo}</span>
        )}
      </span>
      <span className="order-4 justify-self-end text-sm text-muted sm:order-none sm:justify-self-start">
        {receipt.category ? CATEGORY_LABELS[receipt.category] : ""}
      </span>
      <span className="order-2 text-right tabular-nums sm:order-none">
        <span className="block font-medium">
          {receipt.amount} {receipt.symbol}
        </span>
        <span className="block text-sm text-muted">
          {receipt.amount_brl ? formatBRL(receipt.amount_brl) : "No BRL value yet"}
        </span>
      </span>
      <span className="order-5 col-span-2 sm:order-none sm:col-span-1 sm:justify-self-end">
        <StatusBadge status={receipt.status} />
      </span>
    </Link>
  );
}
