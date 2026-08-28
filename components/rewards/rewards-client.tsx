"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/product/empty-state";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { RedeemCard } from "@/components/rewards/redeem-card";
import { cn } from "@/lib/utils";

type ReferralData = {
  code: string | null;
  tier: { name: string; sharePct: number };
  referrals: { pending: number; qualified: number; forfeited: number };
  trading: {
    trades: number;
    volumeUsd: number;
    tier: string;
    multiplier: number;
    nextTierAt: number | null;
    cashbackPoints: number;
  };
  points: number;
  vestedUnsettled: number;
  ledger: {
    id: string;
    points: number;
    reason: string;
    vestsAt: string;
    createdAt: string;
    meta?: { action?: string; tier?: string; volumeUsd?: string } | null;
  }[];
};

type LeaderRow = { handle: string; qualified: number; points: number; tier: string };

const REASON_LABEL: Record<string, string> = {
  REFERRAL: "Referral qualified",
  ACTIVITY: "Activity",
  BONUS: "Bonus",
  FORFEIT: "Forfeited",
};

const ACTION_LABEL: Record<string, string> = {
  cashback: "Trading cashback",
  "wallet-cashback": "Wallet cashback",
  "first-trade": "First trade",
  redeem: "Redeemed to wallet",
  "redeem-returned": "Redemption returned",
  launch: "Token launch",
  trade: "Trade",
};

function ledgerLabel(e: ReferralData["ledger"][number]): string {
  const action = e.meta?.action;
  if (action && ACTION_LABEL[action]) return ACTION_LABEL[action];
  return REASON_LABEL[e.reason] ?? e.reason;
}

function ethFmt(points: number): string {
  const eth = points / 1_000_000;
  if (eth === 0) return "0 ETH";
  const v = Math.abs(eth) >= 0.01 ? eth.toFixed(4) : eth.toFixed(6);
  return `${v.replace(/\.?0+$/, "")} ETH`;
}

function usdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export function RewardsClient({ children }: { children?: React.ReactNode }) {
  const { ready, authenticated, getToken } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/referral", { headers: { authorization: `Bearer ${token}` } });
      if (r.ok) setData(await r.json());
    } catch {
      /* retry on next visit */
    }
  }, [getToken]);

  useEffect(() => {
    if (!ready) return;
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d) => setBoard(d.leaderboard ?? []))
      .catch(() => setBoard([]));
    if (authenticated) load();
  }, [ready, authenticated, load]);

  if (!ready) {
    return <Skeleton className="h-64 rounded-md" />;
  }

  if (!authenticated) {
    return (
      <EmptyState
        label="Rewards"
        title="Sign in to get your code"
        description="Sign in to see your code and rewards."
        action={
          <Button asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
        }
      />
    );
  }

  const shareLink =
    data?.code && typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${data.code}`
      : null;

  const copy = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* code + stats */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <section className="rounded-md border border-line bg-panel">
          <div className="border-b border-line px-4 py-2.5">
            <span className="text-label">Your code</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-5">
            {data ? (
              <>
                <p className="font-mono text-display-lg tracking-[0.08em] text-amber">
                  {data.code ?? "——————"}
                </p>
                <p className="break-all font-mono text-data-sm text-muted">{shareLink}</p>
                <div>
                  <Button variant="secondary" size="sm" onClick={copy} disabled={!shareLink}>
                    {copied ? "Copied" : "Copy share link"}
                  </Button>
                </div>
              </>
            ) : (
              <Skeleton className="h-20" />
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
          {[
            ["Tier", data ? data.tier.name : "…", data && data.tier.sharePct > 0 ? `${data.tier.sharePct}% fee share` : "qualify a referral"],
            ["Qualified", data ? String(data.referrals.qualified) : "…", `${data?.referrals.pending ?? 0} pending`],
            ["Rewards", data ? ethFmt(data.points) : "…", "total accrued · ETH"],
            ["Claimable", data ? ethFmt(data.vestedUnsettled) : "…", "vested · ready to claim"],
          ].map(([k, v, sub]) => (
            <div key={k as string} className="bg-panel px-4 py-4">
              <p className="text-label mb-1">{k}</p>
              <p className="font-mono text-data-lg tabular text-bone">{v}</p>
              <p className="mt-0.5 text-xs text-muted">{sub}</p>
            </div>
          ))}
        </section>
      </div>

      {/* trading cashback */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-label">Trading cashback</span>
          <span className="font-mono text-data-sm text-muted">
            {data ? `${data.trading.tier} · ${data.trading.multiplier}× rate` : "…"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {[
            ["Trader tier", data ? data.trading.tier : "…", data ? `${data.trading.multiplier}× cashback` : ""],
            ["Volume", data ? usdShort(data.trading.volumeUsd) : "…", "lifetime traded"],
            ["Trades", data ? String(data.trading.trades) : "…", "logged + executed"],
            ["Cashback", data ? ethFmt(data.trading.cashbackPoints) : "…", "ETH from volume"],
          ].map(([k, v, sub]) => (
            <div key={k as string} className="bg-panel px-4 py-4">
              <p className="text-label mb-1">{k}</p>
              <p className="font-mono text-data-lg tabular text-bone">{v}</p>
              <p className="mt-0.5 text-xs text-muted">{sub}</p>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          {data && data.trading.nextTierAt
            ? `Every trade earns ETH back on its USD volume, scaled by your tier. Reach ${usdShort(data.trading.nextTierAt)} lifetime volume to level up your cashback rate.`
            : data
              ? "You're at the top trader tier — max cashback rate on every trade."
              : "Every trade earns ETH back on its USD volume; heavier traders earn a higher rate."}
        </p>
      </section>

      {/* redeem vested rewards to a wallet */}
      {data ? (
        <RedeemCard onRedeemed={load} />
      ) : null}

      {/* ledger + leaderboard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-md border border-line bg-panel">
          <div className="border-b border-line px-4 py-2.5">
            <span className="text-label">Rewards ledger</span>
          </div>
          {!data ? (
            <Skeleton className="m-4 h-32" />
          ) : data.ledger.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Nothing yet.
            </p>
          ) : (
            data.ledger.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
              >
                <span
                  className={cn(
                    "font-mono text-data tabular",
                    e.points >= 0 ? "text-gain" : "text-loss",
                  )}
                >
                  {e.points >= 0 ? "+" : "−"}
                  {ethFmt(Math.abs(e.points))}
                </span>
                <span className="text-sm text-bone">
                  {ledgerLabel(e)}
                  {e.meta?.action === "cashback" && e.meta.volumeUsd ? (
                    <span className="text-faint"> · {usdShort(Number(e.meta.volumeUsd))} vol</span>
                  ) : null}
                </span>
                <span className="ml-auto font-mono text-data-sm text-faint">
                  {new Date(e.vestsAt) > new Date()
                    ? "vests " + new Date(e.vestsAt).toLocaleDateString()
                    : "vested"}
                  {" · "}
                  <LiveTimeAgo date={e.createdAt} />
                </span>
              </div>
            ))
          )}
        </section>

        <section className="overflow-hidden rounded-md border border-line bg-panel">
          <div className="border-b border-line px-4 py-2.5">
            <span className="text-label">Leaderboard · qualified referrals</span>
          </div>
          {board === null ? (
            <Skeleton className="m-4 h-32" />
          ) : board.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No referrals yet.</p>
          ) : (
            board.map((row, i) => (
              <div
                key={row.handle}
                className="flex items-center gap-4 border-b border-line px-4 py-2.5 last:border-0"
              >
                <span className="font-mono text-data-sm text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-data text-bone">{row.handle}</span>
                <Badge variant={i === 0 ? "amber" : "neutral"}>{row.tier}</Badge>
                <span className="ml-auto font-mono text-data-sm text-muted">
                  {row.qualified} qualified · {ethFmt(row.points)}
                </span>
              </div>
            ))
          )}
        </section>
      </div>

      {children}
    </div>
  );
}
