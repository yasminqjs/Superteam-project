import type { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { formatUnits } from "@/lib/money/units";
import { canonicalize, sha256Hex } from "@/lib/receipts/canonical";
import { describeReceiptProblem, type ReceiptDocument } from "@/lib/receipts/document";
import { invoiceMemo, sealMemo } from "@/lib/solana/memo";
import {
  extractMemos,
  tokenDeltasByOwner,
  transactionSigners,
  type ParsedTransactionLike,
} from "@/lib/solana/parse";

/**
 * Receipt verification. Needs only the receipt, the seal signature and an RPC
 * connection: Recebi's database is never consulted, so anyone can run this.
 *
 * What it proves: the payment happened onchain, and this receipt was sealed by
 * the recipient and has not been altered since.
 * What it does not prove: who the payer is. `counterparty` is the recipient's word.
 */
export interface VerificationCheck {
  id: "format" | "seal_found" | "seal_hash" | "seal_signer" | "payment_found" | "amount" | "payer" | "invoice";
  label: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  verified: boolean;
  /** SHA-256 of the canonical receipt, recomputed here. */
  hash: string | null;
  receipt: ReceiptDocument | null;
  checks: VerificationCheck[];
}

/**
 * The RPC node could not be reached or kept failing. This is NOT a verdict
 * about the receipt: callers must show it as a network problem, never as a
 * mismatch.
 */
export class RpcUnavailableError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A transaction signature is 64 bytes in base58. Anything else cannot exist onchain. */
function isSignature(text: string): boolean {
  try {
    return bs58.decode(text).length === 64;
  } catch {
    return false;
  }
}

/**
 * Reads one transaction. Returns null when the node says it does not exist;
 * throws RpcUnavailableError when the node cannot be asked (rate limit,
 * network down), after a few attempts.
 */
async function fetchTransaction(
  connection: Connection,
  signature: string,
  retryDelayMs: number,
): Promise<ParsedTransactionLike | null> {
  if (!isSignature(signature)) return null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);
    try {
      return await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (error) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new RpcUnavailableError(`The Solana RPC is not answering (${reason.slice(0, 160)})`);
}

export async function verifyReceipt(input: {
  /** The receipt as JSON text. Whitespace and key order do not matter. */
  receiptJson: string;
  sealSignature: string;
  connection: Connection;
  /** The network this verifier is connected to: "solana:devnet" or "recebi:mock". */
  network: string;
  /** Base wait between attempts when the RPC fails. Tests set it to 0. */
  retryDelayMs?: number;
}): Promise<VerificationResult> {
  const retryDelayMs = input.retryDelayMs ?? 1000;
  const checks: VerificationCheck[] = [];
  const add = (id: VerificationCheck["id"], label: string, ok: boolean, detail: string) => {
    checks.push({ id, label, ok, detail });
    return ok;
  };
  // Never say "onchain" about the mock ledger.
  const found = input.network.startsWith("solana:") ? "Found onchain" : "Found in the mock ledger";
  const finish = (hash: string | null, receipt: ReceiptDocument | null): VerificationResult => ({
    verified: checks.every((check) => check.ok),
    hash,
    receipt,
    checks,
  });

  // 1. The document itself.
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.receiptJson);
  } catch {
    add("format", "Receipt is well formed", false, "The text is not valid JSON");
    return finish(null, null);
  }
  const problem = describeReceiptProblem(parsed);
  if (problem) {
    add("format", "Receipt is well formed", false, problem);
    return finish(null, null);
  }
  const receipt = parsed as ReceiptDocument;
  const hash = await sha256Hex(canonicalize(receipt));
  if (
    !add(
      "format",
      "Receipt is well formed",
      receipt.network === input.network,
      receipt.network === input.network
        ? `Recebi receipt v1 on ${receipt.network}`
        : `This receipt is for ${receipt.network}, but this page checks ${input.network}`,
    )
  ) {
    return finish(hash, receipt);
  }

  // 2. The seal: a memo transaction signed by the recipient.
  const seal = await fetchTransaction(input.connection, input.sealSignature.trim(), retryDelayMs);
  const sealOk = Boolean(seal?.meta && !seal.meta.err);
  add(
    "seal_found",
    "Seal transaction exists and succeeded",
    sealOk,
    sealOk ? found : "No successful transaction with this signature",
  );
  if (seal && sealOk) {
    const expected = sealMemo(hash, receipt.payment_tx);
    const memos = extractMemos(seal);
    add(
      "seal_hash",
      "Seal contains this receipt's hash",
      memos.includes(expected),
      memos.includes(expected)
        ? `Memo matches sha256 ${hash.slice(0, 16)}…`
        : "The hash of this receipt is not what was sealed: the receipt was altered, or this is not its seal",
    );
    const signed = transactionSigners(seal).includes(receipt.recipient_wallet);
    add(
      "seal_signer",
      "Seal was signed by the recipient",
      signed,
      signed ? "Signed by recipient_wallet" : "The recipient wallet did not sign the seal",
    );
  }

  // 3. The payment the receipt is about.
  const payment = await fetchTransaction(input.connection, receipt.payment_tx, retryDelayMs);
  const paymentOk = Boolean(payment?.meta && !payment.meta.err);
  add(
    "payment_found",
    "Payment transaction exists and succeeded",
    paymentOk,
    paymentOk ? found : "No successful transaction with the signature in payment_tx",
  );
  if (payment && paymentOk) {
    const { byOwner, decimals } = tokenDeltasByOwner(payment, receipt.mint);
    const received = byOwner.get(receipt.recipient_wallet) ?? 0n;
    const onchainAmount =
      decimals === null ? null : formatUnits(received, decimals, { minFractionDigits: 2 });
    add(
      "amount",
      "Payment credited exactly this amount to the recipient",
      onchainAmount === receipt.amount,
      onchainAmount === receipt.amount
        ? `${receipt.amount} ${receipt.symbol} credited`
        : `Receipt says ${receipt.amount}, the chain says ${onchainAmount ?? "0.00"}`,
    );

    if (receipt.payer_wallet) {
      const paid = (byOwner.get(receipt.payer_wallet) ?? 0n) < 0n;
      add(
        "payer",
        "Payer's balance decreased",
        paid,
        paid ? "payer_wallet sent tokens in this transaction" : "payer_wallet did not send these tokens",
      );
    }
    if (receipt.invoice_hash) {
      const expected = invoiceMemo(receipt.invoice_hash);
      const found = extractMemos(payment).some((memo) => memo.includes(expected));
      add(
        "invoice",
        "Payment carries the invoice hash",
        found,
        found ? "Invoice hash found in the payment memo" : "The payment memo does not contain invoice_hash",
      );
    }
  }

  return finish(hash, receipt);
}
