"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { Button, ButtonLink } from "@/components/ui";
import { useConnectWallet } from "@/components/wallet/account-control";
import { WalletStatus } from "@/components/wallet/wallet-status";
import { errorMessage } from "@/lib/api-client";
import { IS_MOCK } from "@/lib/mode";

// Optional: the id of a sealed receipt to show off on the landing page.
const SAMPLE_RECEIPT_ID = process.env.NEXT_PUBLIC_SAMPLE_RECEIPT_ID?.trim();

/** The landing page's call to action: connect, then sign in, then open the dashboard. */
export function LandingCta() {
  const router = useRouter();
  const { publicKey, connecting } = useWallet();
  const { session, signIn } = useSession();
  const connectWallet = useConnectWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
      router.push("/app");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const signedIn = session.status === "signed_in";
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {signedIn ? (
          <ButtonLink href="/app" className="h-12 px-6 text-base">
            Open your dashboard
          </ButtonLink>
        ) : publicKey ? (
          <Button onClick={handleSignIn} busy={busy} className="h-12 px-6 text-base">
            Sign in with this wallet
          </Button>
        ) : (
          <Button onClick={connectWallet} busy={connecting} className="h-12 px-6 text-base">
            {IS_MOCK ? "Use demo wallet" : "Connect wallet"}
          </Button>
        )}
        <Link
          href={SAMPLE_RECEIPT_ID ? `/verify/${SAMPLE_RECEIPT_ID}` : "/verify"}
          className="text-sm text-solana-ink underline-offset-4 hover:underline"
        >
          {SAMPLE_RECEIPT_ID ? "See a verified receipt →" : "Verify a receipt →"}
        </Link>
      </div>

      <p className="mt-4 text-sm text-muted">
        {signedIn && "You are signed in."}
        {!signedIn && publicKey && "Signing a message proves the wallet is yours. It is free and sends no transaction."}
        {!signedIn && !publicKey && IS_MOCK && "The demo wallet is built in. No extension needed."}
        {!signedIn && !publicKey && !IS_MOCK && (
          <>
            Use Phantom with testnet mode on and the network set to{" "}
            <span className="font-medium text-ink">Solana Devnet</span>.
          </>
        )}
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {publicKey && (
        <div className="mt-8">
          <WalletStatus />
        </div>
      )}
    </div>
  );
}
