import { LandingCta } from "@/components/landing-cta";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { AccountControl } from "@/components/wallet/account-control";

// Each step wears the colour of what it is about: the chain, reais, and a check that passed.
const STEPS = [
  {
    colour: "text-solana-ink",
    rule: "bg-solana",
    title: "Invoice",
    body: "Send your client a payment link. They pay in stablecoins on Solana, and the hash of the invoice travels inside their own transaction.",
  },
  {
    colour: "text-pix-ink",
    rule: "bg-pix",
    title: "Document",
    body: "Every payment is tied to its invoice, valued in BRL at the Central Bank's PTAX rate and sealed onchain. Earlier payments are imported from the wallet's history.",
  },
  {
    colour: "text-accent",
    rule: "bg-accent",
    title: "Share",
    body: "Your team works on one company account, each person with their own wallet and role. Your accountant or exchange checks any receipt on a public page, without trusting Recebi.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader>
        <AccountControl />
      </SiteHeader>
      {/* Clips the hero's colour washes at the edge of the screen, not of the column. */}
      <div className="flex flex-1 flex-col overflow-x-clip">
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <section className="relative isolate pb-14 pt-16 sm:pb-20 sm:pt-24">
          {/* Two soft washes of the brand's end colours, behind everything. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-40 -top-24 -z-10 size-[30rem] rounded-full bg-solana/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-40 top-40 -z-10 size-[28rem] rounded-full bg-pix/15 blur-3xl"
          />
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span aria-hidden className="size-2 rounded-full bg-solana" />
            Paid on Solana
            <span aria-hidden className="h-px w-5 bg-brand" />
            <span aria-hidden className="size-2 rounded-full bg-pix" />
            Accounted for in reais
          </p>
          <h1 className="mt-6 max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            Invoice abroad. Get paid in stablecoins.{" "}
            <span className="text-brand">Prove every payment.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
            Recebi is the receivables back office for Brazilian companies and freelancers who sell
            services abroad. Each payment arrives tied to its invoice, valued in BRL at the Central
            Bank&apos;s official PTAX rate, and backed by a receipt anyone can verify onchain.
          </p>
          <div className="mt-10">
            <LandingCta />
          </div>
        </section>

        <section aria-label="How it works" className="border-t border-line py-14 sm:py-20">
          <ol className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden className={`block h-1 w-10 rounded-full ${step.rule}`} />
                <p className={`mt-4 font-mono text-sm tabular-nums ${step.colour}`}>0{index + 1}</p>
                <h2 className="mt-3 font-display text-3xl">{step.title}</h2>
                <p className="mt-3 leading-7 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      </div>
      <SiteFooter />
    </>
  );
}
