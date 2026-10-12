"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Button, Card, Eyebrow, Loading, Notice, TxLink } from "@/components/ui";
import { useConnectWallet } from "@/components/wallet/account-control";
import { api, errorMessage } from "@/lib/api-client";
import { shortAddress } from "@/lib/format";
import { IS_MOCK } from "@/lib/mode";
import { formatTokenAmount } from "@/lib/money/units";
import type { InvoiceView } from "@/lib/services/invoices";
import { buildPaymentInstructions } from "@/lib/solana/pay";
import { signAndSend } from "@/lib/solana/send";
import { brtDateTime } from "@/lib/time";

const POLL_MS = 3000;

/** Public payment page for one invoice. Works without an account, on a phone. */
export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const { connection } = useConnection();
  const { publicKey, signTransaction, connecting } = useWallet();
  const connectWallet = useConnectWallet();

  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [paying, setPaying] = useState<"wallet" | "mock" | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  // First load, then ask the server every few seconds whether the payment
  // has landed. The server does the onchain lookup; this page only waits.
  const paid = invoice?.status === "paid";
  useEffect(() => {
    if (paid) return;
    let cancelled = false;
    const check = () =>
      api<{ invoice: InvoiceView }>(`/api/invoices/${id}/status`)
        .then((loaded) => {
          if (!cancelled) setInvoice(loaded.invoice);
        })
        .catch((caught) => {
          if (!cancelled) setLoadError(errorMessage(caught));
        });
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, paid]);

  const payUrl = invoice?.solana_pay_url;
  useEffect(() => {
    if (!payUrl) return;
    let cancelled = false;
    QRCode.toDataURL(payUrl, { margin: 1, width: 480 }).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [payUrl]);

  async function payWithWallet() {
    if (!invoice || !publicKey) return;
    setPaying("wallet");
    setPayError(null);
    try {
      if (!signTransaction) throw new Error("This wallet cannot sign transactions. Try Phantom.");

      // Check the balance first: "you hold 0.00 USDC" is something a person
      // can act on; the node's "custom program error: 0x1" is not.
      const { value: accounts } = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey(invoice.mint),
      });
      const balance = accounts.reduce(
        (sum, { account }) => sum + BigInt(account.data.parsed.info.tokenAmount.amount),
        0n,
      );
      if (balance < BigInt(invoice.amount_raw)) {
        throw new Error(
          `This wallet holds ${formatTokenAmount(balance, invoice.decimals)} ${invoice.symbol}, ` +
            `and the invoice is for ${invoice.amount} ${invoice.symbol}. Switch to a wallet with enough.`,
        );
      }

      const instructions = buildPaymentInstructions({
        payer: publicKey.toBase58(),
        recipient: invoice.issuer_wallet,
        mint: invoice.mint,
        decimals: invoice.decimals,
        amountRaw: BigInt(invoice.amount_raw),
        memo: invoice.memo,
        reference: invoice.reference,
      });
      await signAndSend({
        connection,
        transaction: new Transaction().add(...instructions),
        feePayer: publicKey,
        signTransaction,
      });
      // The poll above picks the payment up within a few seconds.
    } catch (caught) {
      setPayError(errorMessage(caught));
    } finally {
      setPaying(null);
    }
  }

  async function simulateClientPayment() {
    setPaying("mock");
    setPayError(null);
    try {
      await api("/api/mock/pay-invoice", { json: { invoice_id: id } });
    } catch (caught) {
      setPayError(errorMessage(caught));
    } finally {
      setPaying(null);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 py-8 sm:py-14">
        {loadError && !invoice && <Notice>{loadError}</Notice>}
        {!invoice && !loadError && <Loading label="Loading the invoice…" />}
        {invoice && (
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow>Invoice {invoice.number}</Eyebrow>
                <p className="mt-2 text-sm text-muted">Billed to</p>
                <p className="font-medium">{invoice.client_name}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-muted">Pay to</p>
                <p className="font-mono" title={invoice.issuer_wallet}>
                  {shortAddress(invoice.issuer_wallet)}
                </p>
              </div>
            </div>

            <p className="mt-5 text-sm leading-6">{invoice.description}</p>
            <p className="mt-5 border-t border-line pt-5 text-4xl font-semibold tabular-nums">
              {invoice.amount} <span className="text-xl font-medium text-muted">{invoice.symbol}</span>
            </p>

            {paid ? (
              <div className="mt-6 rounded-lg border border-accent/40 bg-accent-soft p-5 text-center">
                <p role="status" className="font-display text-5xl text-accent">
                  Paid ✓
                </p>
                {invoice.paid_at && (
                  <p className="mt-2 text-sm text-ink/80">
                    {brtDateTime(new Date(invoice.paid_at))} Brasília time
                  </p>
                )}
                {invoice.paid_signature && (
                  <p className="mt-2 text-sm">
                    Transaction: <TxLink signature={invoice.paid_signature} />
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="mt-6 flex flex-col items-center">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing for next/image to optimise
                    <img src={qr} alt="Solana Pay QR code for this invoice" className="size-56 rounded-md border border-line" />
                  ) : (
                    <div className="size-56 rounded-md border border-line bg-paper" />
                  )}
                  <p className="mt-3 text-center text-sm text-muted">
                    {IS_MOCK
                      ? "In mock mode this QR code is for show: no real wallet can pay a simulated ledger."
                      : "Scan with a Solana wallet (Phantom on devnet), or pay from this browser."}
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  {IS_MOCK ? (
                    <Button className="w-full" onClick={simulateClientPayment} busy={paying === "mock"}>
                      Simulate the client paying
                    </Button>
                  ) : publicKey?.toBase58() === invoice.issuer_wallet ? (
                    // Paying yourself moves nothing, so the invoice would never be detected as paid.
                    <Notice tone="neutral">
                      The connected wallet is the one that issued this invoice. Switch to the
                      client&apos;s wallet to pay it.
                    </Notice>
                  ) : publicKey ? (
                    <Button className="w-full" onClick={payWithWallet} busy={paying === "wallet"}>
                      Pay with browser wallet
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={connectWallet} busy={connecting}>
                      Connect a wallet to pay
                    </Button>
                  )}
                  {payError && <Notice>{payError}</Notice>}
                  <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted">
                    <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" />
                    Waiting for payment…
                  </p>
                </div>
              </>
            )}

            <p className="mt-6 break-all border-t border-line pt-4 font-mono text-[11px] leading-4 text-muted">
              memo {invoice.memo}
            </p>
          </Card>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
