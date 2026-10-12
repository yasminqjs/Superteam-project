"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AddressText,
  Button,
  ButtonLink,
  Card,
  Eyebrow,
  Field,
  Loading,
  Notice,
  StatusBadge,
  TxLink,
  buttonClass,
  inputClass,
} from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api-client";
import {
  CONTACT_KINDS,
  RECEIPT_CATEGORIES,
  type ContactKind,
  type ReceiptCategory,
} from "@/lib/db/types";
import { CATEGORY_LABELS, CONTACT_KIND_LABELS, describeRate } from "@/lib/labels";
import { LEDGER_NAME } from "@/lib/mode";
import { formatBRL } from "@/lib/money/units";
import { canonicalize, sha256Hex } from "@/lib/receipts/canonical";
import type { ReceiptFile } from "@/lib/receipts/document";
import type { ReceiptView, SealDraft } from "@/lib/services/receipts";
import { createMemoInstruction } from "@/lib/solana/memo";
import { signAndSend } from "@/lib/solana/send";

const SEAL_STEPS = {
  preparing: "Preparing the receipt…",
  signing: "Approve the transaction in your wallet…",
  confirming: "Checking the seal onchain…",
} as const;

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Classification form.
  const [category, setCategory] = useState<ReceiptCategory | "">("");
  const [contactName, setContactName] = useState("");
  const [contactKind, setContactKind] = useState<ContactKind>("client");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [sealStep, setSealStep] = useState<keyof typeof SEAL_STEPS | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [copied, setCopied] = useState(false);

  /** Shows a receipt and resets the form to its stored values. */
  const show = useCallback((next: ReceiptView) => {
    setReceipt(next);
    setCategory(next.category ?? "");
    setContactName(next.contact?.name ?? "");
    setContactKind(next.contact?.kind ?? "client");
    setDescription(next.description ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ receipt: ReceiptView }>(`/api/receipts/${id}`)
      .then(({ receipt: loaded }) => {
        if (!cancelled) show(loaded);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [id, show]);

  if (loadError) return <Notice>{loadError}</Notice>;
  if (!receipt) return <Loading />;

  const sealed = receipt.status === "sealed";
  const dirty =
    category !== (receipt.category ?? "") ||
    description.trim() !== (receipt.description ?? "") ||
    contactName.trim() !== (receipt.contact?.name ?? "") ||
    (contactName.trim() !== "" && contactKind !== (receipt.contact?.kind ?? "client"));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      const { receipt: updated } = await api<{ receipt: ReceiptView }>(`/api/receipts/${id}`, {
        method: "PATCH",
        json: {
          category: category || null,
          description,
          contact: contactName.trim() ? { name: contactName, kind: contactKind } : null,
        },
      });
      show(updated);
      setSaved(true);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function refreshRate() {
    setRefreshingRate(true);
    setFormError(null);
    try {
      const { receipt: updated } = await api<{ receipt: ReceiptView }>(`/api/receipts/${id}/fx`, {
        method: "POST",
      });
      show(updated);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setRefreshingRate(false);
    }
  }

  async function seal() {
    setSealError(null);
    try {
      if (!publicKey || !signTransaction) {
        throw new Error("Connect the wallet that received this payment to seal its receipt.");
      }
      setSealStep("preparing");
      const draft = await api<SealDraft>(`/api/receipts/${id}/seal`, { method: "POST" });
      // The browser recomputes the hash itself: the wallet signs a value we
      // checked here, not one we took on the server's word.
      const localHash = await sha256Hex(canonicalize(JSON.parse(draft.receipt_json)));
      if (localHash !== draft.receipt_hash) {
        throw new Error("The receipt hash computed in the browser differs from the server's. Nothing was signed.");
      }

      setSealStep("signing");
      const signature = await signAndSend({
        connection,
        transaction: new Transaction().add(createMemoInstruction(draft.memo, publicKey)),
        feePayer: publicKey,
        signTransaction,
      });

      setSealStep("confirming");
      // The transaction is already onchain. If the server cannot reach the RPC
      // to check it (503), ask again with the same signature instead of
      // making the user sign a second seal.
      for (let attempt = 0; ; attempt++) {
        try {
          const { receipt: updated } = await api<{ receipt: ReceiptView }>(
            `/api/receipts/${id}/seal`,
            { method: "PUT", json: { signature } },
          );
          show(updated);
          break;
        } catch (caught) {
          const retryable = caught instanceof ApiError && caught.status === 503;
          if (!retryable || attempt >= 3) throw caught;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    } catch (caught) {
      setSealError(errorMessage(caught));
    } finally {
      setSealStep(null);
    }
  }

  async function downloadJson() {
    const published = await api<{ receipt_json: string; seal_signature: string }>(
      `/api/public/receipts/${id}`,
    );
    const file: ReceiptFile = {
      receipt: JSON.parse(published.receipt_json),
      seal_signature: published.seal_signature,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `recebi-receipt-${id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyVerifyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/verify/${id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canSeal = Boolean(receipt.category) && Boolean(receipt.amount_brl) && !dirty;

  return (
    <div>
      <Link href="/app" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
        ← All payments
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-4xl font-semibold tabular-nums sm:text-5xl">
            {receipt.amount} <span className="text-2xl font-medium text-muted sm:text-3xl">{receipt.symbol}</span>
          </p>
          {receipt.amount_brl && receipt.fx ? (
            <>
              <p className="mt-2 text-2xl tabular-nums">{formatBRL(receipt.amount_brl)}</p>
              <p className="mt-1 text-sm tabular-nums text-muted">{describeRate(receipt.fx)}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No BRL value yet: the exchange rate could not be read.</p>
          )}
          {!sealed && (
            <button
              type="button"
              onClick={refreshRate}
              disabled={refreshingRate}
              className="mt-1 text-sm text-accent underline-offset-4 hover:underline disabled:opacity-60"
            >
              {refreshingRate ? "Reading the rate…" : "Refresh rate"}
            </button>
          )}
        </div>
        <StatusBadge status={receipt.status} />
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Card>
          <Eyebrow>Onchain payment</Eyebrow>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Received">
              <span className="tabular-nums">{receipt.block_time_brt}</span>{" "}
              <span className="text-muted">Brasília time</span>
            </Row>
            <Row label="From">
              {receipt.payer_wallet ? <AddressText address={receipt.payer_wallet} chars={6} /> : "Unknown"}
            </Row>
            <Row label="Transaction">
              <TxLink signature={receipt.tx_signature} />
            </Row>
            <Row label="Memo">{receipt.memo ?? <span className="text-muted">None</span>}</Row>
            <Row label="Source">
              {receipt.source === "invoice" ? `Invoice ${receipt.invoice_number ?? ""}` : "Imported from wallet"}
            </Row>
          </dl>
        </Card>

        <Card>
          <Eyebrow>What this payment is</Eyebrow>
          {sealed ? (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Category">{receipt.category && CATEGORY_LABELS[receipt.category]}</Row>
              <Row label="Counterparty">{receipt.contact?.name ?? <span className="text-muted">Not named</span>}</Row>
              <Row label="Description">{receipt.description ?? <span className="text-muted">None</span>}</Row>
            </dl>
          ) : (
            <form onSubmit={save} className="mt-4 space-y-4">
              <Field label="Category">
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ReceiptCategory | "")}
                  className={inputClass}
                >
                  <option value="">Not classified</option>
                  {RECEIPT_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>
              {receipt.payer_wallet && (
                <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
                  <Field label="Who paid" hint="Remembered for this wallet">
                    <input
                      value={contactName}
                      onChange={(event) => setContactName(event.target.value)}
                      placeholder="e.g. Acme Labs"
                      maxLength={120}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="They are a">
                    <select
                      value={contactKind}
                      onChange={(event) => setContactKind(event.target.value as ContactKind)}
                      className={inputClass}
                    >
                      {CONTACT_KINDS.map((value) => (
                        <option key={value} value={value}>
                          {CONTACT_KIND_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. Web app development, September"
                  maxLength={500}
                  rows={2}
                  className={`${inputClass} h-auto py-2`}
                />
              </Field>
              {formError && <Notice>{formError}</Notice>}
              <div className="flex items-center gap-3">
                <Button type="submit" busy={saving} disabled={!dirty}>
                  Save
                </Button>
                {saved && !dirty && <span className="text-sm text-accent">Saved ✓</span>}
              </div>
            </form>
          )}
        </Card>
      </div>

      <section aria-label="Receipt" className="mt-6">
        {sealed ? (
          <div className="rounded-lg border border-accent/40 bg-accent-soft p-5 sm:p-6">
            <p className="font-display text-3xl text-accent">Sealed onchain ✓</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/80">
              The hash of this receipt is recorded on {LEDGER_NAME} in a transaction signed by your
              wallet. Anyone with the link can check it, without trusting Recebi.
            </p>
            <dl className="mt-5 space-y-3 text-sm">
              <Row label="Receipt hash">
                <span className="break-all font-mono text-xs">{receipt.receipt_hash}</span>
              </Row>
              <Row label="Seal transaction">
                {receipt.seal_signature && <TxLink signature={receipt.seal_signature} />}
              </Row>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href={`/verify/${id}`} variant="accent" target="_blank">
                Open public verification
              </ButtonLink>
              <Button variant="secondary" onClick={copyVerifyLink}>
                {copied ? "Copied ✓" : "Copy verify link"}
              </Button>
              <Button variant="secondary" onClick={downloadJson}>
                Download JSON
              </Button>
              <a
                href={`/api/reports/dossier?ids=${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("secondary")}
              >
                Download PDF
              </a>
            </div>
          </div>
        ) : (
          <Card>
            <Eyebrow>Verifiable receipt</Eyebrow>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Sealing writes the SHA-256 hash of this receipt to Solana&apos;s Memo program, in a
              transaction signed by your wallet. After that the receipt can be verified by anyone
              and can no longer be edited.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button variant="accent" onClick={seal} busy={sealStep !== null} disabled={!canSeal}>
                Seal onchain
              </Button>
              <span className="text-sm text-muted">
                {sealStep && SEAL_STEPS[sealStep]}
                {!sealStep && dirty && "Save your changes first."}
                {!sealStep && !dirty && !receipt.category && "Classify this payment first."}
                {!sealStep && !dirty && receipt.category && !receipt.amount_brl && "Needs a BRL value first."}
              </span>
            </div>
            {sealError && (
              <div className="mt-4">
                <Notice>{sealError}</Notice>
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
