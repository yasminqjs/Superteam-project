"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import type { FxRule } from "@/lib/db/types";
import type { SessionInfo } from "@/lib/services/session";
import { can as roleCan, type Permission, type TeamRole } from "@/lib/team";

type SessionState =
  | { status: "loading" }
  | { status: "signed_out" }
  | {
      status: "signed_in";
      /** The account being worked on: the signer's own wallet, or a company's. */
      wallet: string;
      /** The wallet that signed in. */
      signer: string;
      role: TeamRole;
      companyName: string | null;
      fxRule: FxRule;
    };

function signedIn(info: SessionInfo): SessionState {
  return {
    status: "signed_in",
    wallet: info.account,
    signer: info.wallet,
    role: info.role,
    companyName: info.company_name,
    fxRule: info.fx_rule,
  };
}

interface SessionContextValue {
  session: SessionState;
  /** Asks the connected wallet to sign the login message. */
  signIn: () => Promise<void>;
  /** Ends the session and disconnects the wallet. */
  signOut: () => Promise<void>;
  setFxRule: (rule: FxRule) => void;
  /** Asks the server again who is signed in, e.g. after the company's name changed. */
  refresh: () => Promise<void>;
  /** Whether the signed-in wallet may do this on the current account. The server decides again. */
  can: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

type Me = SessionInfo | { wallet: null };

/**
 * Knows who is signed in. The session itself is an httpOnly cookie the page
 * cannot read, so this asks the server (/api/auth/me) and keeps the answer.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect } = useWallet();
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const connectedWallet = publicKey?.toBase58() ?? null;

  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/auth/me")
      .then((me) => {
        if (cancelled) return;
        setSession(me.wallet ? signedIn(me) : { status: "signed_out" });
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "signed_out" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setSession({ status: "signed_out" });
    await disconnect().catch(() => {});
  }, [disconnect]);

  // The session belongs to one wallet. If the user switches account in the
  // wallet, the old session must not keep acting for the previous one.
  const sessionWallet = session.status === "signed_in" ? session.signer : null;
  useEffect(() => {
    if (sessionWallet && connectedWallet && sessionWallet !== connectedWallet) {
      api("/api/auth/logout", { method: "POST" })
        .catch(() => {})
        .then(() => setSession({ status: "signed_out" }));
    }
  }, [sessionWallet, connectedWallet]);

  const signIn = useCallback(async () => {
    if (!connectedWallet) throw new Error("Connect a wallet first.");
    if (!signMessage) throw new Error("This wallet cannot sign messages. Try Phantom.");
    const { message } = await api<{ message: string }>("/api/auth/nonce", {
      json: { wallet: connectedWallet },
    });
    const signature = await signMessage(new TextEncoder().encode(message));
    const me = await api<SessionInfo>("/api/auth/verify", {
      json: { wallet: connectedWallet, signature: bs58.encode(signature) },
    });
    setSession(signedIn(me));
  }, [connectedWallet, signMessage]);

  const setFxRule = useCallback((rule: FxRule) => {
    setSession((current) => (current.status === "signed_in" ? { ...current, fxRule: rule } : current));
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<Me>("/api/auth/me");
    setSession(me.wallet ? signedIn(me) : { status: "signed_out" });
  }, []);

  const role = session.status === "signed_in" ? session.role : null;
  const can = useCallback(
    (permission: Permission) => role !== null && roleCan(role, permission),
    [role],
  );

  const value = useMemo(
    () => ({ session, signIn, signOut, setFxRule, refresh, can }),
    [session, signIn, signOut, setFxRule, refresh, can],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}
