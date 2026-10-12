"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import {
  Button,
  ButtonLink,
  CATEGORY_COLOURS,
  Card,
  CategoryDot,
  Eyebrow,
  Loading,
  Notice,
  PageTitle,
  StatusBadge,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import type { FxRule } from "@/lib/db/types";
import { shortAddress } from "@/lib/format";
import { CATEGORY_LABELS, FX_RULE_LABELS } from "@/lib/labels";
import { formatBRL, formatTokenAmount } from "@/lib/money/units";
import type { InvoiceView } from "@/lib/services/invoices";
import type { ReceiptStatus, ReceiptView } from "@/lib/services/receipts";
import type { MonthlyReport } from "@/lib/services/reports";

interface DashboardData {
  receipts: ReceiptView[];
  report: MonthlyReport;
  invoices: InvoiceView[];
}

async function loadDashboard(): Promise<DashboardData> {
  const [{ receipts }, { report }, { invoices }] = await Promise.all([
    api<{ receipts: ReceiptView[] }>("/api/receipts"),
    api<{ report: MonthlyReport }>("/api/reports"),
    api<{ invoices: InvoiceView[] }>("/api/invoices"),
  ]);
  return { receipts, report, invoices };
}

type Filter = "all" | ReceiptStatus;

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  unclassified: "Unclassified",
  classified: "Classified",
  sealed: "Sealed",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" -> "Oct 2026" */
function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1]} ${year}`;
}

/**
 * How wide a bar is, in percent. This is geometry, not money: the amounts on
 * screen are the server's exact strings, and only the bar goes through a float.
 */
function share(part: string, whole: number): number {
  return whole > 0 ? Math.max(0, Math.min(100, (Number(part) / whole) * 100)) : 0;
}

/** What arrived in a set of receipts, per token: "2,115.00 TUSD". Integer arithmetic on base units. */
function tokenTotals(receipts: ReceiptView[]): string[] {
  const totals = new Map<string, { raw: bigint; decimals: number; symbol: string }>();
  for (const receipt of receipts) {
    const entry = totals.get(receipt.mint) ?? { raw: 0n, decimals: receipt.decimals, symbol: receipt.symbol };
    entry.raw += BigInt(receipt.amount_raw);
    totals.set(receipt.mint, entry);
  }
  return [...totals.values()].map((entry) => `${formatTokenAmount(entry.raw, entry.decimals)} ${entry.symbol}`);
}

export default function DashboardPage() {
  const { session, setFxRule, can } = useSession();
  const canWrite = can("write");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [changingRule, setChangingRule] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

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

  /** Shows one kind of payment in the list and brings the list into view. */
  function showOnly(next: Filter) {
    setFilter(next);
    document.getElementById("payments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const fxRule = session.status === "signed_in" ? session.fxRule : "ptax_buy";

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
        <Overview
          data={data}
          filter={filter}
          fxRule={fxRule}
          canWrite={canWrite}
          changingRule={changingRule}
          onChangeRule={changeRule}
          onFilter={setFilter}
          onShowOnly={showOnly}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  filter,
  fxRule,
  canWrite,
  changingRule,
  onChangeRule,
  onFilter,
  onShowOnly,
}: {
  data: DashboardData;
  filter: Filter;
  fxRule: FxRule;
  canWrite: boolean;
  changingRule: boolean;
  onChangeRule: (rule: FxRule) => void;
  onFilter: (filter: Filter) => void;
  onShowOnly: (filter: Filter) => void;
}) {
  const { receipts, report, invoices } = data;

  const counts: Record<Filter, number> = {
    all: receipts.length,
    unclassified: receipts.filter((receipt) => receipt.status === "unclassified").length,
    classified: receipts.filter((receipt) => receipt.status === "classified").length,
    sealed: receipts.filter((receipt) => receipt.status === "sealed").length,
  };
  const pendingInvoices = invoices.filter((invoice) => invoice.status === "pending").length;
  const sealedShare = counts.all > 0 ? Math.round((counts.sealed / counts.all) * 100) : 0;

  const monthIncome = report.receipts.filter((receipt) => receipt.category !== "own_transfer");
  const received = tokenTotals(monthIncome);
  const previous = report.history.at(-2);

  const historyPeak = Math.max(...report.history.map((entry) => Number(entry.income_brl)));
  const categoryWhole = report.totals.reduce((sum, total) => sum + Number(total.amount_brl), 0);
  const shown = filter === "all" ? receipts : receipts.filter((receipt) => receipt.status === filter);

  const todo = [
    { count: counts.unclassified, label: "to classify", onClick: () => onShowOnly("unclassified") },
    { count: counts.classified, label: "ready to seal", onClick: () => onShowOnly("classified") },
  ].filter((item) => item.count > 0);

  return (
    <>
      <section aria-label="This month" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.45fr_1fr_1fr_1fr]">
        <Card bar="pix">
          <Eyebrow>Income in {monthLabel(report.month)}</Eyebrow>
          <p className="mt-2 whitespace-nowrap text-3xl font-semibold tabular-nums text-pix-ink">
            {formatBRL(report.total_brl_excluding_own)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {previous && Number(previous.income_brl) > 0
              ? `${formatBRL(previous.income_brl)} in ${monthLabel(previous.month)}`
              : "Excludes transfers between your own wallets"}
          </p>
        </Card>

        <Card bar="solana">
          <Eyebrow>Received in {monthLabel(report.month)}</Eyebrow>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {monthIncome.length}
            <span className="ml-2 text-base font-normal text-muted">
              payment{monthIncome.length === 1 ? "" : "s"}
            </span>
          </p>
          <p className="mt-1 text-sm tabular-nums text-muted">
            {received.length > 0 ? received.join(" · ") : "Nothing this month yet"}
          </p>
        </Card>

        <Card bar="brand">
          <Eyebrow>Verifiable receipts</Eyebrow>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {counts.sealed}
            <span className="ml-2 text-base font-normal text-muted">of {counts.all} sealed</span>
          </p>
          <div
            role="progressbar"
            aria-label="Share of payments with a sealed receipt"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sealedShare}
            className="mt-3 h-2 overflow-hidden rounded-full bg-line/60"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${sealedShare}%` }} />
          </div>
        </Card>

        <Card bar="ink">
          <Eyebrow>To do</Eyebrow>
          {todo.length === 0 && pendingInvoices === 0 ? (
            <p className="mt-3 text-sm text-muted">
              {counts.all === 0 ? "Import your wallet to begin." : "Nothing pending."}
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {todo.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="group flex w-full items-baseline gap-2 text-left"
                  >
                    <span className="w-6 text-right text-base font-semibold tabular-nums">{item.count}</span>
                    <span className="text-muted underline-offset-4 group-hover:text-ink group-hover:underline">
                      {item.label}
                    </span>
                  </button>
                </li>
              ))}
              {pendingInvoices > 0 && (
                <li>
                  <Link href="/app/invoices" className="group flex items-baseline gap-2">
                    <span className="w-6 text-right text-base font-semibold tabular-nums">{pendingInvoices}</span>
                    <span className="text-muted underline-offset-4 group-hover:text-ink group-hover:underline">
                      invoice{pendingInvoices === 1 ? "" : "s"} awaiting payment
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Income" className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <Eyebrow>Income by month</Eyebrow>
          <ul className="mt-4 space-y-2.5">
            {report.history.map((entry) => {
              const current = entry.month === report.month;
              return (
                <li key={entry.month} className="grid grid-cols-[4.75rem_1fr_auto] items-center gap-3 text-sm">
                  <span className={current ? "font-medium" : "text-muted"}>{monthLabel(entry.month)}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-line/50">
                    <span
                      className={`block h-full rounded-full ${current ? "bg-pix" : "bg-pix/45"}`}
                      style={{ width: `${share(entry.income_brl, historyPeak)}%` }}
                    />
                  </span>
                  <span className={`min-w-28 text-right tabular-nums ${current ? "font-medium text-pix-ink" : "text-muted"}`}>
                    {formatBRL(entry.income_brl)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-sm text-muted">
            <label htmlFor="fx-rule">Valued in reais at</label>
            <select
              id="fx-rule"
              value={fxRule}
              disabled={changingRule || !canWrite}
              onChange={(event) => onChangeRule(event.target.value as FxRule)}
              className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink"
            >
              {(Object.keys(FX_RULE_LABELS) as FxRule[]).map((rule) => (
                <option key={rule} value={rule}>
                  {FX_RULE_LABELS[rule]}
                </option>
              ))}
            </select>
            <span>
              of each payment&apos;s date. Transfers between your own wallets are not income. Sealed
              receipts never change.
            </span>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <Eyebrow>{monthLabel(report.month)} by category</Eyebrow>
          {report.totals.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No payments this month.</p>
          ) : (
            <>
              <div aria-hidden className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                {report.totals.map((total) => (
                  <span
                    key={`${total.category}-${total.symbol}`}
                    className={CATEGORY_COLOURS[total.category]}
                    style={{ width: `${share(total.amount_brl, categoryWhole)}%` }}
                  />
                ))}
              </div>
              <ul className="mt-4 space-y-2.5 text-sm">
                {report.totals.map((total) => (
                  <li key={`${total.category}-${total.symbol}`} className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <CategoryDot category={total.category} />
                      {CATEGORY_LABELS[total.category]}
                      <span className="text-muted">× {total.count}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block font-medium">
                        {total.amount} {total.symbol}
                      </span>
                      <span className="block text-muted">{formatBRL(total.amount_brl)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        {canWrite && (
          <ButtonLink href="/app/invoices/new" variant="solana">
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

      <section id="payments" aria-label="All payments" className="mt-10 scroll-mt-6">
        {receipts.length === 0 ? (
          <Card className="text-center">
            <p className="font-display text-2xl">No payments yet</p>
            <p className="mt-2 text-sm text-muted">
              Click <span className="font-medium text-ink">Import from wallet</span> to read your
              wallet&apos;s history and list every incoming stablecoin payment.
            </p>
          </Card>
        ) : (
          <>
            <div role="tablist" aria-label="Filter payments" className="flex flex-wrap gap-2">
              {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={filter === option}
                  onClick={() => onFilter(option)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    filter === option
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-surface text-muted hover:border-ink/40 hover:text-ink"
                  }`}
                >
                  {FILTER_LABELS[option]}
                  <span className={`ml-1.5 tabular-nums ${filter === option ? "text-paper/70" : ""}`}>
                    {counts[option]}
                  </span>
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="mt-6 text-sm text-muted">No {FILTER_LABELS[filter].toLowerCase()} payments.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {shown.map((receipt) => (
                  <li key={receipt.id}>
                    <ReceiptRow receipt={receipt} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}

function ReceiptRow({ receipt }: { receipt: ReceiptView }) {
  const from = receipt.contact?.name ?? (receipt.payer_wallet ? shortAddress(receipt.payer_wallet) : "Unknown payer");
  return (
    <Link
      href={`/app/receipts/${receipt.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-4 hover:bg-surface sm:grid-cols-[9.5rem_1fr_8rem_auto_7.5rem] sm:px-3"
    >
      <span className="order-3 text-sm tabular-nums text-muted sm:order-none">{receipt.block_time_brt}</span>
      <span className="order-1 min-w-0 sm:order-none">
        <span className={`block truncate font-medium ${receipt.contact ? "" : "font-mono text-sm"}`}>{from}</span>
        {(receipt.description || receipt.memo) && (
          <span className="block truncate text-sm text-muted">{receipt.description ?? receipt.memo}</span>
        )}
      </span>
      <span className="order-4 flex items-center gap-2 justify-self-end text-sm text-muted sm:order-none sm:justify-self-start">
        {receipt.category && (
          <>
            <CategoryDot category={receipt.category} />
            {CATEGORY_LABELS[receipt.category]}
          </>
        )}
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
