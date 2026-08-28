"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/product/empty-state";
import { SignalScore } from "@/components/product/signal-score";
import { PnlCard, type PnlPosition } from "@/components/portfolio/pnl-card";
import { PerformanceChart } from "@/components/portfolio/performance-chart";
import { usdCompact } from "@/lib/format";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { priceFmt } from "@/lib/mock-series";
import { cn } from "@/lib/utils";

type Position = {
  tokenId: string;
  qty: number;
  avgCostUsd: number;
  realizedPnlUsd: number;
  priceUsd: number | null;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
  token: { id: string; symbol: string; name: string; chain: string; address: string; score: number } | null;
};

type Trade = {
  id: string;
  side: "BUY" | "SELL";
  amountToken: number;
  priceUsd: number;
  occurredAt: string;
  source?: string;
  txHash?: string | null;
  token: { symbol: string; chain: string; address: string };
};

type Portfolio = {
  wallet: string | null;
  balances: { eth: number | null; bnb: number | null };
  cashUsd: number;
  holdingsUsd: number;
  totalUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  investedUsd: number;
  totalPnlUsd: number;
  roiPct: number;
  performance: { t: number; pnl: number }[];
  positions: Position[];
  trades: Trade[];
};

function pnlClass(v: number | null): string {
  if (v === null || Math.abs(v) < 0.005) return "text-muted";
  return v > 0 ? "text-gain" : "text-loss";
}

export function PortfolioClient() {
  const { ready, authenticated, getToken } = useAuth();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareCard, setShareCard] = useState<PnlPosition | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/portfolio", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [getToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    load();
  }, [ready, authenticated, load]);

  if (!ready) {
    return <div className="h-64 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  if (!authenticated) {
    return (
      <EmptyState
        label="Portfolio"
        title="Sign in to open your desk"
        description="Sign in to see your positions."
        action={
          <Button asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
        }
      />
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-md border border-line bg-panel px-6 py-14 text-center">
        <p className="text-sm text-loss">Portfolio unavailable: {error}</p>
        <Button variant="secondary" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-md" />
      </div>
    );
  }

  const totalUnrealized = data.positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0);
  const totalRealized = data.positions.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const holdings = data.positions.filter((p) => p.qty > 0);

  const deleteTrade = async (id: string) => {
    const token = await getToken();
    await fetch("/api/trades", {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    load();
  };

  const totalPnl = data.totalPnlUsd ?? totalRealized + totalUnrealized;
  const usd = (n: number, sign = false) =>
    (sign && n >= 0 ? "+" : n < 0 ? "−" : "") +
    "$" +
    Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      {/* headline PnL */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
        {[
          ["Total value", usd(data.totalUsd ?? 0), "text-bone", null],
          ["Total PnL", usd(totalPnl, true), pnlClass(totalPnl), null],
          [
            "ROI",
            (data.roiPct >= 0 ? "+" : "−") + Math.abs(data.roiPct ?? 0).toFixed(1) + "%",
            pnlClass(data.roiPct ?? 0),
            null,
          ],
          ["Realized", usd(totalRealized, true), pnlClass(totalRealized), null],
          ["Unrealized", usd(totalUnrealized, true), pnlClass(totalUnrealized), null],
        ].map(([k, v, cls]) => (
          <div key={k as string} className="bg-panel px-5 py-4">
            <p className="text-label mb-1">{k}</p>
            <p className={cn("font-mono text-data-lg tabular", cls as string)}>{v}</p>
          </div>
        ))}
      </div>

      {/* performance curve */}
      <PerformanceChart points={data.performance ?? []} />

      {/* balances strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        {[
          ["Cash", usd(data.cashUsd ?? 0)],
          ["Holdings", usd(data.holdingsUsd ?? 0)],
          ["Invested", usd(data.investedUsd ?? 0)],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-5 py-3.5">
            <p className="text-label mb-1">{k}</p>
            <p className="font-mono text-data tabular text-bone">{v}</p>
          </div>
        ))}
      </div>

      {/* holdings */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-label">Holdings</span>
          <span className="font-mono text-data-sm text-muted">
            realized {totalRealized >= 0 ? "+" : ""}${totalRealized.toFixed(2)}
          </span>
        </div>
        {holdings.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No open positions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[1.3fr_auto_auto_auto_auto_auto_auto] items-center gap-x-5 border-b border-line px-4 py-2 font-mono text-data-sm uppercase tracking-[0.1em] text-faint">
              <span>Token</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Avg cost</span>
              <span className="text-right">Price</span>
              <span className="text-right">Value</span>
              <span className="text-right">Open PnL</span>
              <span className="text-right">Signal</span>
            </div>
            {holdings.map((p) => {
              const cells = (
                <>
                  <div className="min-w-0 text-sm font-medium text-bone">
                    {p.token ? (
                      <>
                        {p.token.symbol}
                        <span className="ml-2 font-mono text-data-sm text-faint">{p.token.chain}</span>
                      </>
                    ) : (
                      <span className="text-muted">removed token</span>
                    )}
                  </div>
                  <span className="text-right font-mono text-data tabular text-bone">
                    {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(p.qty)}
                  </span>
                  <span className="text-right font-mono text-data tabular text-muted">{priceFmt(p.avgCostUsd)}</span>
                  <span className="text-right font-mono text-data tabular text-bone">
                    {p.priceUsd !== null ? priceFmt(p.priceUsd) : "—"}
                  </span>
                  <span className="text-right font-mono text-data tabular text-bone">
                    {p.valueUsd !== null ? usdCompact(p.valueUsd) : "—"}
                  </span>
                  <span className={cn("text-right font-mono text-data tabular", pnlClass(p.unrealizedPnlUsd))}>
                    {p.unrealizedPnlUsd !== null
                      ? (p.unrealizedPnlUsd >= 0 ? "+" : "") + "$" + p.unrealizedPnlUsd.toFixed(2)
                      : "—"}
                  </span>
                  <span className="flex items-center justify-end gap-3">
                    {p.token ? <SignalScore score={p.token.score} size="sm" /> : "—"}
                    {p.token ? (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShareCard({
                            symbol: p.token!.symbol,
                            chain: p.token!.chain,
                            // the card shows what went in, not the fill price
                            investedUsd: p.qty * p.avgCostUsd,
                            valueUsd: p.valueUsd,
                            unrealizedPnlUsd: p.unrealizedPnlUsd,
                            realizedPnlUsd: p.realizedPnlUsd,
                            score: p.token!.score,
                          });
                        }}
                        className="rounded border border-line px-2 py-1 font-mono text-data-sm text-muted transition-colors duration-fast hover:border-line-strong hover:text-bone"
                      >
                        Share
                      </button>
                    ) : null}
                  </span>
                </>
              );
              const rowClass =
                "grid min-w-[720px] grid-cols-[1.3fr_auto_auto_auto_auto_auto_auto] items-center gap-x-5 border-b border-line px-4 py-3 last:border-0";
              return p.token ? (
                <Link
                  key={p.tokenId}
                  href={`/token/${p.token.chain.toLowerCase()}/${p.token.address}`}
                  className={cn(rowClass, "transition-colors duration-fast hover:bg-raised")}
                >
                  {cells}
                </Link>
              ) : (
                <div key={p.tokenId} className={rowClass}>
                  {cells}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* history */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">Trade history</span>
        </div>
        {data.trades.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No trades yet.</p>
        ) : (
          data.trades.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-4 border-b border-line px-4 py-2.5 last:border-0"
            >
              <Badge variant={t.side === "BUY" ? "gain" : "loss"}>{t.side}</Badge>
              <span className="text-sm font-medium text-bone">{t.token.symbol}</span>
              {t.source === "EXECUTED" ? <Badge variant="amber">On-chain</Badge> : null}
              <span className="font-mono text-data-sm text-muted">
                {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(t.amountToken)}{" "}
                @ {priceFmt(t.priceUsd)}
              </span>
              <span className="ml-auto flex items-center gap-3 font-mono text-data-sm text-faint">
                {t.txHash ? (
                  <a
                    href={`https://${t.token.chain === "BSC" ? "bscscan.com" : "etherscan.io"}/tx/${t.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-muted"
                  >
                    tx
                  </a>
                ) : null}
                <LiveTimeAgo date={t.occurredAt} />
              </span>
              <button
                onClick={() => deleteTrade(t.id)}
                aria-label="Delete trade"
                className="rounded p-1 text-faint transition-colors duration-fast hover:text-loss"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
          ))
        )}
      </section>

      {shareCard ? <PnlCard position={shareCard} onClose={() => setShareCard(null)} /> : null}
    </div>
  );
}
