"use client";

import { useEffect, useState } from "react";
import { Card, Eyebrow, Loading, Notice, PageTitle, StatusBadge, buttonClass, inputClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import { CATEGORY_LABELS } from "@/lib/labels";
import { formatBRL } from "@/lib/money/units";
import type { MonthlyReport } from "@/lib/services/reports";

export default function ReportsPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Receipts ticked for the proof-of-origin PDF. Null = the default (all sealed ones).
  const [picked, setPicked] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ report: MonthlyReport }>(`/api/reports${month ? `?month=${month}` : ""}`)
      .then((loaded) => {
        if (cancelled) return;
        setReport(loaded.report);
        setPicked(null);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (error) return <Notice>{error}</Notice>;
  if (!report) return <Loading />;

  const selected =
    picked ?? new Set(report.receipts.filter((r) => r.status === "sealed").map((r) => r.id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div>
      <PageTitle title="Reports">
        <select
          aria-label="Month"
          value={report.month}
          onChange={(event) => setMonth(event.target.value)}
          className={`${inputClass} w-auto tabular-nums`}
        >
          {report.months.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </PageTitle>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <Eyebrow>Totals for {report.month}</Eyebrow>
          <table className="mt-4 w-full text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="pb-2 font-normal">Category</th>
                <th className="pb-2 text-right font-normal">Payments</th>
                <th className="pb-2 text-right font-normal">Amount</th>
                <th className="pb-2 text-right font-normal">Value in BRL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-y border-line">
              {report.totals.map((total) => (
                <tr key={`${total.category}-${total.symbol}`}>
                  <td className="py-2">{CATEGORY_LABELS[total.category]}</td>
                  <td className="py-2 text-right">{total.count}</td>
                  <td className="py-2 text-right">
                    {total.amount} {total.symbol}
                  </td>
                  <td className="py-2 text-right">{formatBRL(total.amount_brl)}</td>
                </tr>
              ))}
              {report.totals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-muted">
                    No payments in this month.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-3 font-medium">
                  All incoming payments
                </td>
                <td className="pt-3 text-right font-medium">{formatBRL(report.total_brl)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="pt-1 text-muted">
                  Excluding transfers between own wallets
                </td>
                <td className="pt-1 text-right">{formatBRL(report.total_brl_excluding_own)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card>
          <Eyebrow>For your accountant</Eyebrow>
          <div className="mt-4 flex flex-col gap-3">
            <a href={`/api/reports/csv?month=${report.month}`} className={buttonClass("primary")}>
              Download CSV
            </a>
            <a
              href={`/api/reports/pdf?month=${report.month}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary")}
            >
              Summary PDF
            </a>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Informational records only. Not tax advice. Recebi stores the rate and the date used;
            your accountant decides the rule.
          </p>
        </Card>
      </div>

      <section aria-label="Proof of origin" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl">Proof of origin</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              A PDF for an exchange or a bank: one block per payment, with its onchain references and
              a QR code that opens the public verification.
            </p>
          </div>
          {selected.size > 0 ? (
            <a
              href={`/api/reports/dossier?ids=${[...selected].join(",")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("primary")}
            >
              Proof of origin PDF ({selected.size})
            </a>
          ) : (
            <span className={buttonClass("primary", "pointer-events-none opacity-50")}>
              Select payments below
            </span>
          )}
        </div>

        <ul className="mt-5 divide-y divide-line border-y border-line">
          {report.receipts.map((receipt) => (
            <li key={receipt.id}>
              <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 py-3 hover:bg-surface sm:grid-cols-[auto_9.5rem_1fr_auto_7.5rem] sm:px-3">
                <input
                  type="checkbox"
                  checked={selected.has(receipt.id)}
                  onChange={() => toggle(receipt.id)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="hidden text-sm tabular-nums text-muted sm:block">{receipt.block_time_brt}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {receipt.contact?.name ?? "Unnamed payer"}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {CATEGORY_LABELS[receipt.category ?? "unclassified"]}
                    <span className="sm:hidden"> · {receipt.block_time_brt}</span>
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  <span className="block font-medium">
                    {receipt.amount} {receipt.symbol}
                  </span>
                  <span className="block text-sm text-muted">
                    {receipt.amount_brl ? formatBRL(receipt.amount_brl) : "—"}
                  </span>
                </span>
                <span className="col-start-2 sm:col-start-auto sm:justify-self-end">
                  <StatusBadge status={receipt.status} />
                </span>
              </label>
            </li>
          ))}
        </ul>
        {report.receipts.length === 0 && (
          <p className="mt-4 text-sm text-muted">No payments in this month.</p>
        )}
      </section>
    </div>
  );
}
