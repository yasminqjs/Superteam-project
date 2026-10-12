"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "@/components/providers/session-provider";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Card, Loading } from "@/components/ui";
import { AccountBar } from "@/components/wallet/account-bar";
import { AccountControl } from "@/components/wallet/account-control";

const NAV = [
  { href: "/app", label: "Payments" },
  { href: "/app/invoices", label: "Invoices" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/cash-out", label: "Cash out" },
  { href: "/app/team", label: "Team" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app" || pathname.startsWith("/app/receipts");
  return pathname.startsWith(href);
}

/** Shell of the signed-in area. Everything under /app requires a session. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();

  return (
    <>
      <SiteHeader>
        <AccountControl />
      </SiteHeader>
      <AccountBar />
      {session.status === "signed_in" && (
        <nav aria-label="Sections" className="border-b border-line">
          <div className="mx-auto flex w-full max-w-5xl gap-6 overflow-x-auto px-5 sm:px-8">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 py-3 text-sm ${
                  isActive(pathname, item.href)
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        {session.status === "loading" && <Loading />}
        {session.status === "signed_out" && (
          <Card className="mx-auto mt-10 max-w-md text-center">
            <h1 className="font-display text-3xl">Sign in to continue</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Your payments are private to your wallet and to the team you choose. Connect your
              wallet and sign a message to prove it is yours. Signing is free and sends no
              transaction.
            </p>
            <div className="mt-6 flex justify-center">
              <AccountControl />
            </div>
          </Card>
        )}
        {session.status === "signed_in" && children}
      </main>
      <SiteFooter />
    </>
  );
}
