import Link from "next/link";
import type { ReactNode } from "react";
import { IS_MOCK } from "@/lib/mode";

/**
 * The top bar: wordmark, a badge saying which network this is, and whatever
 * the page puts on the right (account controls on the app, nothing on the
 * public pay and verify pages).
 */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-display text-2xl leading-none tracking-tight">
            Recebi
          </Link>
          {/* Hidden on very narrow phones, where the connected address needs the room. */}
          <span className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted min-[400px]:inline-block">
            {IS_MOCK ? "Mock" : "Devnet"}
          </span>
        </div>
        {children}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <p className="mx-auto w-full max-w-5xl px-5 py-6 text-sm text-muted sm:px-8">
        {IS_MOCK ? "Mock mode: simulated data. " : "Devnet only. "}
        Recebi does not convert currency, custody funds or calculate taxes.
      </p>
    </footer>
  );
}
