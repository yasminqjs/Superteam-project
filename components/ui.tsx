import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { shortAddress } from "@/lib/format";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana/cluster";

/** Small shared building blocks, so every screen speaks the same visual language. */

const BUTTON_BASE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  primary: "bg-ink text-paper hover:bg-ink/85",
  secondary: "border border-line bg-surface text-ink hover:border-ink/40",
  accent: "bg-accent text-white hover:bg-accent/90",
  ghost: "text-muted hover:text-ink",
};

type Variant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(variant: Variant = "primary", extra = ""): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={buttonClass(variant, className)}
    >
      {busy && (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</div>
  );
}

/** Small uppercase label above a value or a section. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wider text-muted">{children}</p>;
}

const BADGE_TONES = {
  neutral: "border-line bg-paper text-muted",
  ink: "border-ink/20 bg-surface text-ink",
  accent: "border-accent/30 bg-accent-soft text-accent",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: "unclassified" | "classified" | "sealed" }) {
  if (status === "sealed") return <Badge tone="accent">Sealed ✓</Badge>;
  if (status === "classified") return <Badge tone="ink">Classified</Badge>;
  return <Badge>Unclassified</Badge>;
}

export function Notice({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "accent" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent",
    neutral: "border border-line bg-surface text-muted",
  };
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink " +
  "placeholder:text-muted/70 focus:border-ink/50 focus:outline-none disabled:bg-paper disabled:text-muted";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** A transaction signature, shortened, linking to the explorer. */
export function TxLink({ signature, chars = 8 }: { signature: string; chars?: number }) {
  const url = explorerTxUrl(signature);
  const external = url.startsWith("http");
  return (
    <a
      href={url}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      title={signature}
      className="font-mono text-accent underline-offset-4 hover:underline"
    >
      {shortAddress(signature, chars)}
      {external ? " ↗" : ""}
    </a>
  );
}

/** A wallet address, shortened. Links to the explorer when there is one (not in mock mode). */
export function AddressText({ address, chars = 4 }: { address: string; chars?: number }) {
  const url = explorerAddressUrl(address);
  if (!url) {
    return (
      <span className="font-mono" title={address}>
        {shortAddress(address, chars)}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className="font-mono text-accent underline-offset-4 hover:underline"
    >
      {shortAddress(address, chars)} ↗
    </a>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="py-10 text-sm text-muted">{label}</p>;
}
