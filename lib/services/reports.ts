import Decimal from "decimal.js";
import type { ReceiptCategory } from "@/lib/db/types";
import { badRequest } from "@/lib/errors";
import { formatTokenAmount, formatUnits } from "@/lib/money/units";
import type { Deps } from "@/lib/services/deps";
import { listReceiptViews, type ReceiptView } from "@/lib/services/receipts";
import { explorerTxUrl } from "@/lib/solana/cluster";
import { brtDate } from "@/lib/time";

export interface CategoryTotal {
  category: ReceiptCategory | "unclassified";
  symbol: string;
  count: number;
  /** Display amount in the token, e.g. "1,700.00". */
  amount: string;
  amount_brl: string;
}

export interface MonthlyReport {
  /** YYYY-MM, Brasília time. */
  month: string;
  /** Months that have at least one receipt, newest first, plus the current one. */
  months: string[];
  receipts: ReceiptView[];
  totals: CategoryTotal[];
  total_brl: string;
  /** Transfers between the user's own wallets are not income. */
  total_brl_excluding_own: string;
}

const monthOf = (receipt: ReceiptView) => receipt.block_time_brt.slice(0, 7);

function sumBrl(receipts: ReceiptView[]): string {
  return receipts
    .reduce((sum, receipt) => sum.plus(receipt.amount_brl ?? "0"), new Decimal(0))
    .toFixed(2);
}

export async function buildMonthlyReport(
  deps: Deps,
  owner: string,
  requestedMonth: string | null,
): Promise<MonthlyReport> {
  const currentMonth = brtDate(deps.now()).slice(0, 7);
  const month = requestedMonth || currentMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest("Month must look like 2026-10");

  const all = await listReceiptViews(deps, owner);
  const months = [...new Set([currentMonth, ...all.map(monthOf)])].sort().reverse();
  const receipts = all.filter((receipt) => monthOf(receipt) === month);

  const groups = new Map<string, ReceiptView[]>();
  for (const receipt of receipts) {
    const key = `${receipt.category ?? "unclassified"}|${receipt.mint}`;
    groups.set(key, [...(groups.get(key) ?? []), receipt]);
  }
  const totals: CategoryTotal[] = [...groups.values()].map((group) => ({
    category: group[0].category ?? "unclassified",
    symbol: group[0].symbol,
    count: group.length,
    amount: formatTokenAmount(
      group.reduce((sum, receipt) => sum + BigInt(receipt.amount_raw), 0n),
      group[0].decimals,
    ),
    amount_brl: sumBrl(group),
  }));
  totals.sort((a, b) => a.category.localeCompare(b.category) || a.symbol.localeCompare(b.symbol));

  return {
    month,
    months,
    receipts,
    totals,
    total_brl: sumBrl(receipts),
    total_brl_excluding_own: sumBrl(receipts.filter((r) => r.category !== "own_transfer")),
  };
}

const CSV_COLUMNS = [
  "date_brt",
  "tx_signature",
  "explorer_url",
  "category",
  "counterparty",
  "payer_wallet",
  "token",
  "amount",
  "fx_rule",
  "fx_date",
  "fx_rate",
  "amount_brl",
  "receipt_hash",
  "seal_signature",
  "verify_url",
  "invoice_number",
] as const;

/**
 * One CSV cell. Quotes when needed, and neutralises cells a spreadsheet would
 * run as a formula: memos and names come from other people.
 */
function csvCell(value: string | null, freeText = false): string {
  let text = value ?? "";
  if (freeText && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function absoluteUrl(url: string, appUrl: string): string {
  return url.startsWith("/") ? `${appUrl}${url}` : url;
}

export function verifyUrl(receiptId: string, appUrl: string): string {
  return `${appUrl}/verify/${receiptId}`;
}

/**
 * The accountant's export. Amounts are plain decimals with a dot (no thousands
 * separators), so they import as numbers. Starts with a UTF-8 byte order mark,
 * which is what makes Excel read accented names correctly.
 */
export function buildCsv(receipts: ReceiptView[], appUrl: string): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const receipt of receipts) {
    lines.push(
      [
        csvCell(receipt.block_time_brt),
        csvCell(receipt.tx_signature),
        csvCell(absoluteUrl(explorerTxUrl(receipt.tx_signature), appUrl)),
        csvCell(receipt.category),
        csvCell(receipt.contact?.name ?? null, true),
        csvCell(receipt.payer_wallet),
        csvCell(receipt.symbol),
        csvCell(formatUnits(BigInt(receipt.amount_raw), receipt.decimals, { minFractionDigits: 2 })),
        csvCell(receipt.fx?.rule ?? null),
        csvCell(receipt.fx?.date ?? null),
        csvCell(receipt.fx?.rate ?? null),
        csvCell(receipt.amount_brl),
        csvCell(receipt.receipt_hash),
        csvCell(receipt.seal_signature),
        csvCell(receipt.seal_signature ? verifyUrl(receipt.id, appUrl) : null),
        csvCell(receipt.invoice_number),
      ].join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
