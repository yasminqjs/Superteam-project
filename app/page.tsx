import { LandingCta } from "@/components/landing-cta";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import { AccountControl } from "@/components/wallet/account-control";

const STEPS = [
  {
    title: "Invoice",
    body: "Send your client a payment link. They pay in stablecoins on Solana, and the hash of the invoice travels inside their own transaction.",
  },
  {
    title: "Document",
    body: "Every payment is tied to its invoice, valued in BRL at the Central Bank's PTAX rate and sealed onchain. Earlier payments are imported from the wallet's history.",
  },
  {
    title: "Share",
    body: "Your team works on one company account, each person with their own wallet and role. Your accountant or exchange checks any receipt on a public page, without trusting Yvex Chain.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader>
        <AccountControl />
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <section className="pb-14 pt-16 sm:pb-20 sm:pt-24">
          <h1 className="max-w-3xl font-display text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            Invoice abroad. Get paid in stablecoins. Prove every payment.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
            Yvex Chain is the receivables back office for Brazilian companies and freelancers who sell
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
                <p className="font-mono text-sm tabular-nums text-accent">0{index + 1}</p>
                <h2 className="mt-3 font-display text-3xl">{step.title}</h2>
                <p className="mt-3 leading-7 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
