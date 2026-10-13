import { SiteFooter, SiteHeader } from "@/components/site-header";
import { Verifier } from "@/components/verify/verifier";

export const metadata = { title: "Verify a receipt · Yvex Chain" };

/** Verification that does not depend on Recebi's database: paste or load a receipt. */
export default function VerifyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">Verify a receipt</h1>
        <p className="mt-3 max-w-2xl leading-7 text-muted">
          Paste a Yvex Chain receipt and the signature of its seal. Your browser recomputes the
          receipt&apos;s hash and reads both transactions from Solana.
        </p>
        <div className="mt-10">
          <Verifier />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
