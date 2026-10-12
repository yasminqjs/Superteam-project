"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, Card, Eyebrow, Field, Notice, TxLink, inputClass } from "@/components/ui";
import { errorMessage } from "@/lib/api-client";
import { shortAddress } from "@/lib/format";
import { CATEGORY_LABELS, describeRate } from "@/lib/labels";
import { IS_MOCK, LEDGER_NAME, NETWORK_ID } from "@/lib/mode";
import { formatBRL } from "@/lib/money/units";
import { verifyReceipt, type VerificationResult } from "@/lib/receipts/verify";

/**
 * Accepts either a bare receipt or the downloaded file { receipt, seal_signature }.
 * Returns the receipt as JSON text and the seal signature found, if any.
 */
function unwrapReceiptFile(text: string): { receiptJson: string; sealSignature: string | null } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "receipt" in parsed) {
      const file = parsed as { receipt: unknown; seal_signature?: unknown };
      return {
        receiptJson: JSON.stringify(file.receipt, null, 2),
        sealSignature: typeof file.seal_signature === "string" ? file.seal_signature : null,
      };
    }
  } catch {
    // Not JSON: verification will say so.
  }
  return { receiptJson: text, sealSignature: null };
}

/** The seal: the loudest element in the product. Green when everything checks, red otherwise. */
function Seal({ verified }: { verified: boolean }) {
  // A scalloped disc, like a notary's stamp.
  const points = Array.from({ length: 48 }, (_, index) => {
    const radius = index % 2 === 0 ? 59 : 54;
    const angle = (index / 48) * 2 * Math.PI;
    return `${(60 + radius * Math.cos(angle)).toFixed(2)},${(60 + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
  const colour = verified ? "var(--color-accent)" : "var(--color-danger)";
  return (
    <div className="flex items-center gap-5 sm:gap-7">
      <svg viewBox="0 0 120 120" aria-hidden className="size-24 shrink-0 sm:size-36">
        <polygon points={points} fill={colour} />
        <circle cx="60" cy="60" r="45" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="1.5 4" />
        {verified ? (
          <path d="M41 62l13 13 26-29" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M44 44l32 32M76 44L44 76" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" />
        )}
      </svg>
      <div>
        <p
          role="status"
          className={`font-display text-6xl leading-none tracking-tight sm:text-8xl ${verified ? "text-accent" : "text-danger"}`}
        >
          {verified ? "Verified" : "Mismatch"}
        </p>
        <p className="mt-2 text-sm text-muted sm:text-base">
          {verified
            ? `This receipt matches what is recorded on ${LEDGER_NAME}.`
            : `This receipt does not match what is recorded on ${LEDGER_NAME}.`}
        </p>
      </div>
    </div>
  );
}

export function Verifier({
  initialReceiptJson = "",
  initialSealSignature = "",
  autoRun = false,
}: {
  initialReceiptJson?: string;
  initialSealSignature?: string;
  autoRun?: boolean;
}) {
  const { connection } = useConnection();
  const [receiptJson, setReceiptJson] = useState(initialReceiptJson);
  const [sealSignature, setSealSignature] = useState(initialSealSignature);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With a known receipt (/verify/[id]) the editor starts closed: it is the tamper test.
  const [editorOpen, setEditorOpen] = useState(!autoRun);
  const ranInitially = useRef(false);

  const run = useCallback(
    async (json: string, signature: string) => {
      setRunning(true);
      setError(null);
      try {
        const unwrapped = unwrapReceiptFile(json);
        setResult(
          await verifyReceipt({
            receiptJson: unwrapped.receiptJson,
            sealSignature: unwrapped.sealSignature ?? signature,
            connection,
            network: NETWORK_ID,
          }),
        );
      } catch (caught) {
        // A network failure is shown as exactly that. It must never look like
        // a verdict about the receipt.
        setResult(null);
        setError(
          `${errorMessage(caught)}. This is a network problem, not a verdict about the receipt. Try again in a moment.`,
        );
      } finally {
        setRunning(false);
      }
    },
    [connection],
  );

  useEffect(() => {
    if (!autoRun || ranInitially.current) return;
    ranInitially.current = true;
    void run(initialReceiptJson, initialSealSignature);
  }, [autoRun, run, initialReceiptJson, initialSealSignature]);

  function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const unwrapped = unwrapReceiptFile(text);
      setReceiptJson(unwrapped.receiptJson);
      if (unwrapped.sealSignature) setSealSignature(unwrapped.sealSignature);
      setResult(null);
    });
  }

  const receipt = result?.receipt;
  const failed = result?.checks.filter((check) => !check.ok) ?? [];

  return (
    <div className="space-y-8">
      {running && !result && <p className="py-6 text-muted">Reading the transactions…</p>}
      {error && <Notice>{error}</Notice>}

      {result && (
        <section aria-label="Result" className={running ? "opacity-50" : ""}>
          <Seal verified={result.verified} />
          {!result.verified && failed.length > 0 && (
            <p className="mt-5 text-sm text-danger">
              Failed: {failed.map((check) => check.label).join("; ")}.
            </p>
          )}

          {receipt && (
            <Card className="mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-3xl font-semibold tabular-nums">
                  {receipt.amount} <span className="text-xl font-medium text-muted">{receipt.symbol}</span>
                </p>
                {receipt.amount_brl && <p className="text-xl tabular-nums text-pix-ink">{formatBRL(receipt.amount_brl)}</p>}
              </div>
              {receipt.fx && <p className="mt-1 text-sm tabular-nums text-muted">{describeRate(receipt.fx)}</p>}
              <dl className="mt-5 grid gap-x-8 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-2">
                <Fact label="Recipient wallet">
                  <span className="font-mono" title={receipt.recipient_wallet}>
                    {shortAddress(receipt.recipient_wallet, 6)}
                  </span>
                </Fact>
                <Fact label="Payer wallet">
                  {receipt.payer_wallet ? (
                    <span className="font-mono" title={receipt.payer_wallet}>
                      {shortAddress(receipt.payer_wallet, 6)}
                    </span>
                  ) : (
                    "Unknown"
                  )}
                </Fact>
                <Fact label="Counterparty (declared)">{receipt.counterparty ?? "Not named"}</Fact>
                <Fact label="Category">{CATEGORY_LABELS[receipt.category] ?? receipt.category}</Fact>
                <Fact label="Payment confirmed">{receipt.block_time}</Fact>
                <Fact label="Receipt issued">{receipt.issued_at}</Fact>
                {receipt.description && <Fact label="Description">{receipt.description}</Fact>}
              </dl>
            </Card>
          )}

          <ol className="mt-8 divide-y divide-line border-y border-line">
            {result.checks.map((check) => (
              <li key={check.id} className="flex gap-3 py-3 text-sm">
                <span
                  aria-label={check.ok ? "Passed" : "Failed"}
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${check.ok ? "bg-accent" : "bg-danger"}`}
                >
                  {check.ok ? "✓" : "✗"}
                </span>
                <span>
                  <span className="font-medium">{check.label}</span>
                  <span className={`block ${check.ok ? "text-muted" : "text-danger"}`}>{check.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          {receipt && (
            <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <span>
                Seal: <TxLink signature={unwrapReceiptFile(receiptJson).sealSignature ?? sealSignature} />
              </span>
              <span>
                Payment: <TxLink signature={receipt.payment_tx} />
              </span>
              {result.hash && <span className="font-mono text-xs">sha256 {result.hash.slice(0, 20)}…</span>}
            </p>
          )}
        </section>
      )}

      <section aria-label="Receipt input">
        {!editorOpen ? (
          <Card>
            <Eyebrow>Tamper test</Eyebrow>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Do not take our word for it. Open the receipt, change any value (the amount, for
              example) and verify again: the hash will no longer match the seal.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => setEditorOpen(true)}>
              Tamper test
            </Button>
          </Card>
        ) : (
          <Card>
            <Eyebrow>{autoRun ? "Tamper test" : "Receipt to verify"}</Eyebrow>
            <div className="mt-4 space-y-4">
              <Field label="Receipt JSON" hint={autoRun ? "Edit any value, then verify again" : "Paste it, or load the downloaded file"}>
                <textarea
                  value={receiptJson}
                  onChange={(event) => setReceiptJson(event.target.value)}
                  spellCheck={false}
                  rows={autoRun ? 14 : 10}
                  placeholder='{"type":"recebi.receipt", ...}'
                  className={`${inputClass} h-auto py-2 font-mono text-xs leading-5`}
                />
              </Field>
              <Field label="Seal transaction signature">
                <input
                  value={sealSignature}
                  onChange={(event) => setSealSignature(event.target.value)}
                  spellCheck={false}
                  placeholder="Signature of the memo transaction that sealed the receipt"
                  className={`${inputClass} font-mono text-xs`}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="accent"
                  busy={running}
                  disabled={!receiptJson.trim()}
                  onClick={() => run(receiptJson, sealSignature)}
                >
                  {result ? "Verify again" : "Verify"}
                </Button>
                {!autoRun && (
                  <label className="cursor-pointer text-sm text-accent underline-offset-4 hover:underline">
                    Load a receipt file
                    <input type="file" accept="application/json,.json" onChange={loadFile} className="sr-only" />
                  </label>
                )}
                {autoRun && (
                  <button
                    type="button"
                    className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
                    onClick={() => {
                      setReceiptJson(initialReceiptJson);
                      setSealSignature(initialSealSignature);
                      void run(initialReceiptJson, initialSealSignature);
                    }}
                  >
                    Restore the original
                  </button>
                )}
              </div>
            </div>
          </Card>
        )}
      </section>

      <p className="max-w-2xl text-sm leading-6 text-muted">
        <span className="font-medium text-ink">
          Proves the payment happened onchain and that this receipt was sealed by the recipient and
          not altered since. Counterparty identity is declared by the recipient.
        </span>{" "}
        The check runs in your browser, straight against a Solana RPC node: Recebi&apos;s database is
        not consulted.
        {IS_MOCK && (
          <span className="mt-2 block text-danger">
            Mock mode: here the &quot;chain&quot; is a simulated ledger inside this app, so this
            result proves nothing to a third party. Real verification needs live mode.
          </span>
        )}
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
