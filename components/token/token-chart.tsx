"use client";

import { useCallback, useEffect, useState } from "react";
import { PriceChart, type ChartMarker, type TradeMarker } from "./price-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";
import type { Candle } from "@/lib/mock-series";

/*
  Client-side chart loader — the page paints instantly; candles arrive from
  /api/ohlcv (cached) at the selected timeframe. Falls back to server-provided
  candles when the pool has no history yet.
*/
const TIMEFRAMES = [
  { v: "live", label: "Live" },
  { v: "15m", label: "15m" },
  { v: "1h", label: "1H" },
  { v: "6h", label: "6H" },
  { v: "24h", label: "24H" },
] as const;
type Tf = (typeof TIMEFRAMES)[number]["v"];

export function TokenChart({
  chain,
  pool,
  address,
  tokenId,
  fallbackCandles,
  liquidity,
  markers,
}: {
  chain: string;
  pool: string | null;
  /* the token itself, for the live price tick — the pool is for candles */
  address?: string;
  tokenId?: string;
  fallbackCandles: Candle[];
  liquidity: { time: number; value: number }[];
  markers: ChartMarker[];
}) {
  const { ready, authenticated, getToken } = useAuth();
  const [tf, setTf] = useState<Tf>("15m");
  // no pool → nothing to fetch, so settle immediately (never a stuck skeleton)
  const [candles, setCandles] = useState<Candle[] | null>(
    pool ? null : fallbackCandles?.length ? fallbackCandles : [],
  );
  const [trades, setTrades] = useState<TradeMarker[]>([]);

  // the signed-in user's own trades on THIS token → B/S markers on the chart
  const loadTrades = useCallback(async () => {
    if (!tokenId || !authenticated) return;
    try {
      const tok = await getToken();
      if (!tok) return;
      const r = await fetch("/api/trades", { headers: { authorization: `Bearer ${tok}` }, cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as {
        trades: { tokenId: string; side: "BUY" | "SELL"; occurredAt: string }[];
      };
      setTrades(
        data.trades
          .filter((tr) => tr.tokenId === tokenId)
          .map((tr) => ({ time: Math.floor(new Date(tr.occurredAt).getTime() / 1000), side: tr.side })),
      );
    } catch {
      /* non-blocking */
    }
  }, [tokenId, authenticated, getToken]);

  useEffect(() => {
    if (ready && authenticated) loadTrades();
    // refresh markers right after a trade completes
    const onTrade = () => loadTrades();
    if (typeof window !== "undefined") window.addEventListener("quantai:balance", onTrade);
    return () => {
      if (typeof window !== "undefined") window.removeEventListener("quantai:balance", onTrade);
    };
  }, [ready, authenticated, loadTrades]);

  // live: pull fresh candles every 15s so the chart moves, not just on load
  useEffect(() => {
    if (!pool) return;
    let alive = true;
    setCandles(null); // show skeleton while the new timeframe loads
    // a pool with almost no history (brand-new pairs, V4 pool ids) must never
    // leave the chart stuck on a skeleton — fall back, or show an empty state
    const settle = (prev: Candle[] | null) =>
      prev ?? (fallbackCandles?.length ? fallbackCandles : []);
    const pull = () =>
      fetch(`/api/ohlcv/${chain}/${pool}?tf=${tf}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setCandles(d.candles?.length >= 6 ? d.candles : settle);
        })
        .catch(() => alive && setCandles(settle));
    pull();
    // candles refresh on their own cadence; the forming candle is kept live
    // between pulls by the price tick below
    const t = setInterval(pull, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, pool, tf]);

  /*
    Keep the forming candle alive between pulls.

    Candle history only moves when the upstream aggregates a new bar, so
    between pulls the chart sat perfectly still — which on a screen someone is
    trading from reads as a stalled feed. This asks what the token costs right
    now and extends the newest candle with it: the close follows the price and
    the high/low stretch to contain it, exactly as a forming bar behaves.

    Only the last candle is touched. Closed bars are history and are never
    rewritten.
  */
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/live-prices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokens: [{ chain, address }] }),
        });
        if (!r.ok || !alive) return;
        const { prices } = (await r.json()) as { prices: Record<string, { priceUsd: number }> };
        const px = Object.values(prices)[0]?.priceUsd;
        if (!(px > 0) || !alive) return;
        setCandles((prev) => {
          if (!prev || prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.close === px) return prev;
          const updated = {
            ...last,
            close: px,
            high: Math.max(last.high, px),
            low: Math.min(last.low, px),
          };
          return [...prev.slice(0, -1), updated];
        });
      } catch {
        /* the next tick tries again */
      }
    };
    void tick();
    const t = setInterval(tick, 1_500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [chain, address]);

  const tfBar = (
    <div className="flex gap-1">
      {TIMEFRAMES.map((o) => (
        <button
          key={o.v}
          onClick={() => setTf(o.v)}
          aria-pressed={tf === o.v}
          className={cn(
            "rounded px-2.5 py-1 font-mono text-data-sm uppercase tracking-[0.08em] transition-colors duration-fast",
            tf === o.v ? "bg-raised text-amber" : "text-muted hover:text-bone",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  if (!candles) {
    return (
      <div className="min-w-0 rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          {tfBar}
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-[460px] w-full rounded-none" />
      </div>
    );
  }

  // loaded, but this pair has no usable history yet (very fresh pool)
  if (candles.length < 2) {
    return (
      <div className="min-w-0 rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          {tfBar}
          <span className="font-mono text-data-sm text-faint">no history yet</span>
        </div>
        <div className="flex h-[460px] items-center justify-center px-6 text-center">
          <p className="max-w-xs text-sm text-muted">Too new for a chart.</p>
        </div>
      </div>
    );
  }

  return (
    <PriceChart
      candles={candles}
      liquidity={liquidity}
      markers={markers}
      tradeMarkers={trades}
      timeframeBar={tfBar}
      timeframe={tf}
    />
  );
}
