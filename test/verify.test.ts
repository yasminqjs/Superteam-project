import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import { RpcUnavailableError, verifyReceipt } from "@/lib/receipts/verify";

// The happy path and the tamper cases run against the mock node in
// mock-flow.test.ts. Here: how verification behaves when the RPC misbehaves.

const signature = (fill: number) => bs58.encode(new Uint8Array(64).fill(fill));

const RECEIPT = JSON.stringify({
  type: "recebi.receipt",
  v: 1,
  network: "solana:devnet",
  amount: "1200.00",
  symbol: "USDC",
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  amount_brl: "6518.52",
  payment_tx: signature(7),
  payer_wallet: null,
  recipient_wallet: "75AjMdh7Gn1TLigfze541AVJGJ4TyqBEaRZk3pozfBza",
  invoice_hash: null,
});

function connectionWith(
  getParsedTransaction: (signature: string, options: unknown) => Promise<unknown>,
) {
  const spy = vi.fn(getParsedTransaction);
  return { connection: { getParsedTransaction: spy } as unknown as Connection, spy };
}

const input = (connection: Connection, sealSignature = signature(9)) => ({
  receiptJson: RECEIPT,
  sealSignature,
  connection,
  network: "solana:devnet",
  retryDelayMs: 0,
});

describe("verifyReceipt when the RPC misbehaves", () => {
  it("reports an unreachable RPC as an error, never as a mismatch", async () => {
    const { connection, spy } = connectionWith(async () => {
      throw new Error("429 Too Many Requests");
    });
    await expect(verifyReceipt(input(connection))).rejects.toBeInstanceOf(RpcUnavailableError);
    // Three attempts for the first transaction, then it gives up.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("retries a request that fails once", async () => {
    let calls = 0;
    const { connection } = connectionWith(async () => {
      if (++calls === 1) throw new Error("fetch failed");
      return null;
    });
    const result = await verifyReceipt(input(connection));
    // The node answered: neither transaction exists. That IS a verdict.
    expect(result.verified).toBe(false);
    expect(result.checks.filter((check) => !check.ok).map((check) => check.id)).toEqual([
      "seal_found",
      "payment_found",
    ]);
  });

  it("does not ask the RPC about something that is not a signature", async () => {
    const { connection, spy } = connectionWith(async () => null);
    const result = await verifyReceipt(input(connection, "not-a-signature"));
    expect(result.checks.find((check) => check.id === "seal_found")?.ok).toBe(false);
    // Only the payment transaction was looked up.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(signature(7), expect.anything());
  });

  it("refuses a receipt for another network without touching the RPC", async () => {
    const { connection, spy } = connectionWith(async () => null);
    const result = await verifyReceipt({ ...input(connection), network: "recebi:mock" });
    expect(result.verified).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
