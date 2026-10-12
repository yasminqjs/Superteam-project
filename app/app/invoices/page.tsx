"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Badge, ButtonLink, Card, Loading, Notice, PageTitle } from "@/components/ui";
import { api, errorMessage } from "@/lib/api-client";
import type { InvoiceView } from "@/lib/services/invoices";
import { brtDateTime } from "@/lib/time";

export default function InvoicesPage() {
  const { can } = useSession();
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ invoices: InvoiceView[] }>("/api/invoices")
      .then((loaded) => {
        if (!cancelled) setInvoices(loaded.invoices);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyLink(id: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/pay/${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div>
      <PageTitle title="Invoices">
        {can("write") && <ButtonLink href="/app/invoices/new">New invoice</ButtonLink>}
      </PageTitle>
      <p className="mt-3 max-w-2xl text-muted">
        Send a client a payment link. When they pay, the payment arrives here already classified,
        with the invoice&apos;s hash inside the transaction.
      </p>

      <div className="mt-8">
        {error && <Notice>{error}</Notice>}
        {!invoices && !error && <Loading />}
        {invoices?.length === 0 && (
          <Card className="text-center">
            <p className="font-display text-2xl">No invoices yet</p>
            <p className="mt-2 text-sm text-muted">Create one and share its payment link with your client.</p>
          </Card>
        )}
        {invoices && invoices.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[6rem_1fr_auto_5.5rem_auto] sm:px-3"
              >
                <span className="font-mono text-sm">{invoice.number}</span>
                <span className="order-first col-span-2 min-w-0 sm:order-none sm:col-span-1">
                  <span className="block truncate font-medium">{invoice.client_name}</span>
                  <span className="block truncate text-sm text-muted">
                    {invoice.description} · {brtDateTime(new Date(invoice.created_at))}
                  </span>
                </span>
                <span className="text-right font-medium tabular-nums">
                  {invoice.amount} {invoice.symbol}
                </span>
                <span>
                  {invoice.status === "paid" ? <Badge tone="accent">Paid ✓</Badge> : <Badge tone="warn">Pending</Badge>}
                </span>
                <span className="flex gap-4 justify-self-end text-sm">
                  <a
                    href={`/pay/${invoice.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-solana-ink underline-offset-4 hover:underline"
                  >
                    Payment page
                  </a>
                  <button
                    type="button"
                    onClick={() => copyLink(invoice.id)}
                    className="text-muted underline-offset-4 hover:text-ink hover:underline"
                  >
                    {copiedId === invoice.id ? "Copied ✓" : "Copy link"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
