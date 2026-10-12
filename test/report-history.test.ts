import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode, set before any module reads it (see mock-flow.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_RECEBI_MODE = "mock";
});

import { FileStore } from "@/lib/db/file-store";
import { fetchMockPtax } from "@/lib/fx/ptax";
import { MOCK_KEYS } from "@/lib/mock/keys";
import { seedMock } from "@/lib/mock/seed";
import type { Deps } from "@/lib/services/deps";
import { classifyReceipt, importReceipts, listReceiptViews } from "@/lib/services/receipts";
import { buildMonthlyReport, monthsEndingAt } from "@/lib/services/reports";
import { createMockConnection } from "@/lib/solana/server-connection";

const ANA = MOCK_KEYS.ana.publicKey.toBase58();
const NOW = new Date("2026-10-14T15:00:00Z");

describe("monthsEndingAt", () => {
  it("lists the months oldest first, ending at the one asked for", () => {
    expect(monthsEndingAt("2026-10", 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("crosses the turn of the year", () => {
    expect(monthsEndingAt("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsEndingAt("2026-01", 1)).toEqual(["2026-01"]);
  });
});

describe("income history in the monthly report", () => {
  let deps: Deps;

  beforeEach(async () => {
    seedMock(NOW);
    deps = { store: new FileStore(), connection: createMockConnection(), fetchPtax: fetchMockPtax, now: () => NOW };
    await importReceipts(deps, ANA);
  });

  it("covers six months and ends at the month of the report", async () => {
    const report = await buildMonthlyReport(deps, ANA, null);
    expect(report.history.map((entry) => entry.month)).toEqual(monthsEndingAt("2026-10", 6));
    expect(report.history.at(-1)).toEqual({ month: "2026-10", income_brl: report.total_brl_excluding_own });
    expect(report.history.slice(0, -1).every((entry) => entry.income_brl === "0.00")).toBe(true);
  });

  it("leaves out transfers between the user's own wallets, like the month total does", async () => {
    const before = await buildMonthlyReport(deps, ANA, null);
    const [any] = await listReceiptViews(deps, ANA);
    await classifyReceipt(deps, ANA, any.id, { category: "own_transfer", description: null, contact: null });
    const after = await buildMonthlyReport(deps, ANA, null);

    expect(after.history.at(-1)!.income_brl).toBe(after.total_brl_excluding_own);
    expect(Number(after.history.at(-1)!.income_brl)).toBeLessThan(Number(before.history.at(-1)!.income_brl));
    expect(after.total_brl).toBe(before.total_brl);
  });
});
