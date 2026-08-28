"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type Activity = {
  tokens: { chain: string; symbol: string; txCount: number; holding: boolean }[];
  tradedCount: number;
  holdingCount: number;
} | null;

type Wallet = {
  id: string;
  address: string;
  chain: string;
  verified: boolean;
  cashbackPoints: number;
  activity: Activity;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const fmtEth = (points: number) => {
  const eth = points / 1_000_000;
  if (eth === 0) return "—";
  const s = Math.abs(eth) >= 0.01 ? eth.toFixed(4) : eth.toFixed(6);
  return `+${s.replace(/\.?0+$/, "")} ETH`;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ExternalWalletCard({ policyText }: { policyText: string }) {
  const { ready, authenticated, getToken, linkExternalWallet } = useAuth();
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/rewards/wallet", { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) setWallets((await r.json()).wallets ?? []);
    } catch {
      /* retry next visit */
    }
  }, [getToken]);

  useEffect(() => {
    if (ready && authenticated) load();
  }, [ready, authenticated, load]);

  const disconnect = useCallback(
    async (id: string) => {
      if (!window.confirm("Disconnect this wallet? Any cashback already credited stays in your balance.")) return;
      try {
        const token = await getToken();
        await fetch("/api/rewards/wallet", {
          method: "DELETE",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ id }),
        });
        await load();
      } catch {
        /* ignore */
      }
    },
    [getToken, load],
  );

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Privy opens the connect modal (MetaMask, mobile wallets, …), then we
      // sign an ownership message with the connected wallet.
      const payload = await linkExternalWallet();
      if (!payload) {
        setError("Wallet connection isn't available. Try again, or use a wallet-enabled browser.");
        return;
      }
      const token = await getToken();
      const r = await fetch("/api/rewards/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.error ?? "Couldn't link that wallet.");
      }
      await load();
    } catch (e) {
      const msg = (e as Error).message ?? "Connection failed.";
      setError(
        /user rejected|denied|cancel/i.test(msg)
          ? "Connection or signature was cancelled."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }, [getToken, load, linkExternalWallet]);

  if (!ready || !authenticated) return null;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-label">Memecoin-trader cashback</span>
        <Button size="sm" variant="secondary" onClick={connect} disabled={busy}>
          {busy ? "Waiting for wallet…" : "Connect a trading wallet"}
        </Button>
      </div>

      <p className="border-b border-line px-4 py-3 text-sm text-muted">{policyText}</p>

      {error ? (
        <p className="border-b border-line px-4 py-2.5 font-mono text-data-sm text-loss">{error}</p>
      ) : null}

      {wallets === null ? (
        <Skeleton className="m-4 h-16" />
      ) : wallets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No wallets connected.
        </p>
      ) : (
        wallets.map((w) => (
          <div key={w.id} className="border-b border-line last:border-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="font-mono text-data-sm text-bone">{short(w.address)}</span>
              <Badge variant={w.verified ? "gain" : "warn"}>{w.verified ? "Verified" : "Pending"}</Badge>
              {w.activity ? (
                <span className="font-mono text-data-sm text-muted">
                  {w.activity.tradedCount} tokens traded · {w.activity.holdingCount} held
                </span>
              ) : null}
              {w.reviewedAt ? (
                <Badge variant="bone">Reviewed</Badge>
              ) : (
                <span className="font-mono text-data-sm text-faint">awaiting review</span>
              )}
              <span className="ml-auto font-mono text-data tabular text-gain">
                {fmtEth(w.cashbackPoints)}
              </span>
              <button
                onClick={() => disconnect(w.id)}
                aria-label="Disconnect wallet"
                title="Disconnect"
                className="rounded p-1 text-faint transition-colors duration-fast hover:text-loss"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            {w.activity && w.activity.tokens.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {w.activity.tokens.map((t, i) => (
                  <span
                    key={`${t.chain}-${t.symbol}-${i}`}
                    className={
                      "rounded-full border px-2 py-0.5 font-mono text-data-sm " +
                      (t.holding ? "border-gain/40 text-gain" : "border-line text-muted")
                    }
                    title={t.holding ? "holding" : "traded"}
                  >
                    {t.symbol}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
