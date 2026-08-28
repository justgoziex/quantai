"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { usdCompact, countCompact, age } from "@/lib/format";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { useAuth } from "@/components/auth/auth-context";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/product/empty-state";
import { ScoreWithBreakdown } from "@/components/product/score-tooltip";
import { WatchStar } from "@/components/product/watch-star";
import { QuickBuy } from "@/components/screener/quick-buy";
import { ChainLogo } from "@/components/brand/chain-logo";
import { useI18n } from "@/lib/i18n";

type ApiToken = {
  id: string;
  chain: "ETH" | "BSC" | "BASE" | "RH" | "SOL";
  address: string;
  name: string;
  symbol: string;
  dex: string | null;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  pairCreatedAt: string | null;
  currentScore: number;
  gateBreakdown: Record<string, number> | null;
  flags: string[];
  promoted?: boolean;
  market?: { priceChange24h?: number; priceUsd?: number } | null;
};

const FLAG_META: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  LP_LOCKED: { variant: "gain", label: "LP locked" },
  VERIFIED: { variant: "bone", label: "Verified" },
  HONEYPOT_RISK: { variant: "loss", label: "Honeypot risk" },
  MINT_OPEN: { variant: "loss", label: "Mint open" },
  SELL_TRAP: { variant: "loss", label: "Sell trap" },
  RUGCHECKED: { variant: "gain", label: "Rug-checked" },
  RUG_RISK: { variant: "loss", label: "Rug risk" },
  SIM_PENDING: { variant: "warn", label: "Sim pending" },
  DUMPING: { variant: "loss", label: "Dumping" },
  UNVERIFIED: { variant: "warn", label: "Unverified" },
};
function flagMeta(flag: string) {
  if (FLAG_META[flag]) return FLAG_META[flag];
  if (flag.startsWith("TOP10_"))
    return { variant: "warn" as const, label: `Top10 ${flag.slice(6).replace("PCT", "%")}` };
  if (flag.startsWith("TAX_"))
    return { variant: "warn" as const, label: `Tax ${flag.slice(4).replace("PCT", "%")}` };
  return { variant: "neutral" as const, label: flag.toLowerCase().replace(/_/g, " ") };
}

/* filter definitions */
const CHAINS = [
  { v: "", label: "All chains" },
  { v: "ETH", label: "ETH" },
  { v: "BSC", label: "BSC" },
  { v: "BASE", label: "Base" },
  { v: "RH", label: "Robinhood" },
  { v: "SOL", label: "Solana" },
];
const LIQ = [
  { v: 0, label: "Any liq" },
  { v: 25_000, label: "≥$25K" },
  { v: 50_000, label: "≥$50K" },
  { v: 100_000, label: "≥$100K" },
];
const SCORE = [
  { v: 0, label: "Any score" },
  { v: 40, label: "≥40" },
  { v: 70, label: "≥70" },
];
const AGE = [
  { v: 0, label: "Any age" },
  { v: 60, label: "<1h" },
  { v: 360, label: "<6h" },
  { v: 1440, label: "<24h" },
];

function Seg<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { t: tr } = useI18n();
  return (
    <div className="flex shrink-0 overflow-hidden rounded border border-line">
      {options.map((o, i) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={cn(
            "whitespace-nowrap px-2.5 py-1.5 font-mono text-data-sm transition-colors duration-fast",
            i > 0 && "border-l border-line",
            value === o.v ? "bg-raised text-amber" : "text-muted hover:text-bone",
          )}
        >
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

/*
  The feed refreshes fast enough to feel alive rather than static. Rows reorder
  themselves as ranking changes, new pairs slide in at the top, and a price
  move flashes on the row that moved — the movement IS the signal that this is
  live data, not a list someone wrote down.
*/
const POLL_MS = 2_500;
/*
  Prices refresh far more often than the list itself. The upstream answer is
  cached for a few seconds server-side and shared between everyone watching the
  same tokens, so a fast tick here costs one read no matter how many people are
  looking.
*/
const PRICE_MS = 1_200;

export function ScreenerClient({ initialTokens }: { initialTokens?: ApiToken[] }) {
  const { ready, authenticated, getToken } = useAuth();
  const { t: tr } = useI18n();
  const [category, setCategory] = useState<"new" | "trending" | "trenching" | "movers">("new");
  const [chain, setChain] = useState("");
  const [minLiq, setMinLiq] = useState(0);
  const [minScore, setMinScore] = useState(0);
  const [maxAge, setMaxAge] = useState(0);

  const [tokens, setTokens] = useState<ApiToken[] | null>(initialTokens?.length ? initialTokens : null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const firstLoad = useRef(true);
  /* last price seen per token — drives the green/red flash on a move */
  const prevPrices = useRef<Map<string, number>>(new Map());
  const [moved, setMoved] = useState<Map<string, "up" | "down">>(new Map());
  const PAGE = 60;
  /* how many pages are on screen — the poll refreshes all of them */
  const pagesRef = useRef(1);
  /*
    Live quotes for the rows actually rendered, read straight from the market
    rather than the stored row. The catalogue refreshes on a rotation, which
    means the number beside a token can be hours old — fine for a directory,
    useless when someone is deciding whether to buy right now.
  */
  const [live, setLive] = useState<Map<string, { priceUsd: number; liquidityUsd: number; marketCapUsd: number }>>(new Map());

  const query = useCallback(
    (offset = 0, limit = PAGE) => {
      const p = new URLSearchParams();
      p.set("category", category);
      p.set("limit", String(limit));
      if (offset) p.set("offset", String(offset));
      if (chain) p.set("chain", chain);
      if (minLiq) p.set("minLiquidity", String(minLiq));
      if (minScore) p.set("minScore", String(minScore));
      if (maxAge) p.set("maxAgeMinutes", String(maxAge));
      return p.toString();
    },
    [category, chain, minLiq, minScore, maxAge],
  );

  // changing any filter starts a new list, so the depth resets with it
  useEffect(() => {
    pagesRef.current = 1;
  }, [category, chain, minLiq, minScore, maxAge]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        /*
          Refresh everything currently on screen, not just the first page.
          The poll used to refetch one page and replace the whole list, so
          pressing "load more" added rows that the next poll wiped out two
          seconds later — the list appeared to reshuffle instead of grow.
        */
        const r = await fetch(`/api/tokens?${query(0, PAGE * pagesRef.current)}`, { signal });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
        const data = (await r.json()) as { tokens: ApiToken[]; nextOffset: number | null };

        /*
          Work out which rows actually moved since the last poll, so only those
          flash. Flashing everything on every refresh would be noise, and the
          eye would stop reading it.
        */
        const nextMoved = new Map<string, "up" | "down">();
        for (const t of data.tokens) {
          const now = Number(t.market?.priceUsd ?? 0);
          const before = prevPrices.current.get(t.id);
          if (before != null && now > 0 && now !== before) {
            nextMoved.set(t.id, now > before ? "up" : "down");
          }
          if (now > 0) prevPrices.current.set(t.id, now);
        }
        if (nextMoved.size > 0) {
          setMoved(nextMoved);
          // let the flash fade before the next poll paints over it
          setTimeout(() => setMoved(new Map()), 1_100);
        }

        setTokens(data.tokens);
        setNextOffset(data.nextOffset);
        setError(null);
        setUpdatedAt(new Date());
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      }
    },
    [query],
  );

  const streamPrices = useCallback(async (rows: ApiToken[]) => {
    if (rows.length === 0) return;
    try {
      const r = await fetch("/api/live-prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokens: rows.slice(0, 120).map((t) => ({ chain: t.chain.toLowerCase(), address: t.address })),
        }),
      });
      if (!r.ok) return;
      const { prices } = (await r.json()) as {
        prices: Record<string, { priceUsd: number; liquidityUsd: number; marketCapUsd: number }>;
      };
      const next = new Map<string, { priceUsd: number; liquidityUsd: number; marketCapUsd: number }>();
      const flash = new Map<string, "up" | "down">();
      for (const t of rows) {
        const q = prices[`${t.chain.toLowerCase()}:${t.address}`];
        if (!q || !(q.priceUsd > 0)) continue;
        next.set(t.id, q);
        const before = prevPrices.current.get(t.id);
        if (before != null && q.priceUsd !== before) flash.set(t.id, q.priceUsd > before ? "up" : "down");
        prevPrices.current.set(t.id, q.priceUsd);
      }
      if (next.size > 0) setLive(next);
      if (flash.size > 0) {
        setMoved(flash);
        setTimeout(() => setMoved(new Map()), 900);
      }
    } catch {
      /* the next tick tries again */
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/tokens?${query(nextOffset)}`);
      const data = (await r.json()) as { tokens: ApiToken[]; nextOffset: number | null };
      setTokens((prev) => {
        const seen = new Set((prev ?? []).map((t) => t.id));
        return [...(prev ?? []), ...data.tokens.filter((t) => !seen.has(t.id))];
      });
      setNextOffset(data.nextOffset);
      // remember the depth so the live poll keeps refreshing all of it
      pagesRef.current += 1;
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [nextOffset, loadingMore, query]);

  // kick a server-side ingest (self-throttled) then fetch; poll both
  useEffect(() => {
    const ctrl = new AbortController();
    // keep the server-rendered rows on screen for the very first pass;
    // clear only when the user actually changes a filter
    if (firstLoad.current && (tokens?.length ?? 0) > 0) {
      firstLoad.current = false;
    } else {
      setTokens(null);
    }
    const ingest = () => fetch("/api/ingest", { method: "POST" }).catch(() => {});
    ingest();
    load(ctrl.signal);
    const t = setInterval(() => {
      ingest();
      load(ctrl.signal);
    }, POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [load]);

  /*
    Prices tick on their own, far faster than the catalogue poll.

    Reloading the whole board to move a price would be wasteful and would make
    rows jump as the ordering shifts underneath. This asks only "what do these
    tokens cost right now" and paints the answer onto the rows already there,
    so the numbers move continuously while the list itself stays put.
  */
  useEffect(() => {
    if (!tokens || tokens.length === 0) return;
    void streamPrices(tokens);
    const t = setInterval(() => void streamPrices(tokens), PRICE_MS);
    return () => clearInterval(t);
  }, [tokens, streamPrices]);

  // watchlist state for signed-in users
  useEffect(() => {
    if (!ready || !authenticated) return;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch("/api/watchlist", { headers: { authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const data = (await r.json()) as { watchlist: { tokenId: string }[] };
        setWatched(new Set(data.watchlist.map((w) => w.tokenId)));
      } catch {
        /* non-blocking */
      }
    })();
  }, [ready, authenticated, getToken]);

  const onToggleWatch = (tokenId: string, next: boolean) => {
    setWatched((prev) => {
      const s = new Set(prev);
      if (next) s.add(tokenId);
      else s.delete(tokenId);
      return s;
    });
  };

  const resetFilters = () => {
    setChain("");
    setMinLiq(0);
    setMinScore(0);
    setMaxAge(0);
  };

  const loaded = tokens !== null;
  if (loaded) firstLoad.current = false;

  return (
    <TooltipProvider delayDuration={150}>
      {/* feed tabs — New pairs / Trending / Trenching (mid-life memecoins) */}
      <div className="mb-5 flex items-center gap-6 border-b border-line">
        {(
          [
            { v: "new", label: "New" },
            { v: "trending", label: "Trending" },
            { v: "trenching", label: "Trenching" },
            { v: "movers", label: "Movers" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.v}
            onClick={() => setCategory(tab.v)}
            aria-pressed={category === tab.v}
            className={cn(
              "-mb-px border-b pb-2.5 text-sm transition-colors duration-fast",
              category === tab.v
                ? "border-amber font-medium text-bone"
                : "border-transparent text-muted hover:text-bone",
            )}
          >
            {tr(tab.label)}
          </button>
        ))}
      </div>

      {/* filter bar — scrolls horizontally on small screens */}
      <div className="mb-5 flex items-center gap-3 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
        <Seg options={CHAINS} value={chain} onChange={setChain} />
        <Seg options={LIQ} value={minLiq} onChange={setMinLiq} />
        <Seg options={SCORE} value={minScore} onChange={setMinScore} />
        <Seg options={AGE} value={maxAge} onChange={setMaxAge} />
        <span className="ml-auto flex items-center gap-2 font-mono text-data-sm text-muted">
          {updatedAt ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-gain motion-safe:animate-live-pulse" aria-hidden="true" />
              {tokens?.length ?? 0} pairs · updated <LiveTimeAgo date={updatedAt} />
            </>
          ) : null}
        </span>
      </div>

      {/* feed */}
      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="hidden grid-cols-[auto_1.4fr_auto_auto_auto_auto_auto_1.2fr_auto] items-center gap-x-4 border-b border-line px-4 py-2.5 font-mono text-data-sm uppercase tracking-[0.1em] text-muted lg:grid">
          <span className="w-6" />
          <span>{tr("Token")}</span>
          <span className="text-right">{tr("Age")}</span>
          <span className="text-right">{tr("Liquidity")}</span>
          <span className="text-right">{tr("Market cap")}</span>
          <span className="text-right">24h</span>
          <span className="text-right">{tr("Holders")}</span>
          <span>{tr("Flags")}</span>
          <span className="text-right">{tr("Signal")}</span>
        </div>

        {!loaded && !error && (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0">
                <Skeleton className="h-4 w-4 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="mb-1.5 h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
                <Skeleton className="hidden h-3 w-12 sm:block" />
                <Skeleton className="hidden h-3 w-16 sm:block" />
                <Skeleton className="hidden h-4 w-28 lg:block" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <p className="text-sm text-loss">Feed unavailable: {error}</p>
            <Button variant="secondary" size="sm" onClick={() => load()}>
              Retry
            </Button>
          </div>
        )}

        {loaded && tokens.length === 0 && !error && (
          <EmptyState
            className="rounded-none border-0"
            label="Screener"
            title="No pairs match these filters"
            description="Loosen a filter."
            action={
              <Button variant="secondary" onClick={resetFilters}>
                Reset filters
              </Button>
            }
          />
        )}

        {loaded && (
          <AnimatePresence initial={false}>
            {tokens.map((t, i) => (
            <motion.div
              key={t.id}
              /* `layout` is what makes a row slide to its new rank instead of
                 jumping there — the list reorders visibly as ranking changes */
              layout
              initial={firstLoad.current ? { opacity: 0, y: 6 } : { opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{
                layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                duration: 0.24,
                delay: firstLoad.current ? i * 0.035 : 0,
                ease: [0.25, 1, 0.5, 1],
              }}
              className={cn(
                "transition-colors duration-500",
                moved.get(t.id) === "up" && "bg-gain/[0.09]",
                moved.get(t.id) === "down" && "bg-loss/[0.09]",
              )}
            >
              <Link
                href={`/token/${t.chain.toLowerCase()}/${t.address}`}
                className={cn(
                  "grid grid-cols-[auto_1fr_auto] items-center gap-x-4 border-b border-line px-4 py-3 transition-colors duration-fast last:border-0 hover:bg-raised lg:grid-cols-[auto_1.4fr_auto_auto_auto_auto_auto_1.2fr_auto]",
                  t.promoted && "bg-amber/[0.04] hover:bg-amber/[0.07]",
                )}
              >
                <WatchStar tokenId={t.id} watched={watched.has(t.id)} onToggle={onToggleWatch} />
                <div className="flex min-w-0 items-center gap-2.5">
                  <ChainLogo chain={t.chain} size={20} className="shrink-0" />
                  <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-bone">
                    <span className="truncate">
                      {t.name} <span className="text-muted">({t.symbol})</span>
                    </span>
                    {t.promoted ? <Badge variant="amber">Promoted</Badge> : null}
                  </p>
                  <p className="truncate font-mono text-data-sm text-faint">
                    {t.symbol} / {t.chain === "BSC" ? "WBNB" : t.chain === "SOL" ? "SOL" : "WETH"}
                    <span className="text-muted"> · {t.chain}</span>
                    {t.dex ? <span> · {t.dex}</span> : null}
                  </p>
                  </div>
                </div>
                <span className="hidden text-right font-mono text-data text-muted lg:block">
                  {age(t.pairCreatedAt)}
                </span>
                {/* the live quote when we have one, the stored row otherwise */}
                <span className="hidden text-right font-mono text-data text-bone lg:block">
                  {usdCompact(live.get(t.id)?.liquidityUsd ?? t.liquidityUsd)}
                </span>
                <span className="hidden text-right font-mono text-data text-bone lg:block">
                  {usdCompact(live.get(t.id)?.marketCapUsd ?? t.marketCapUsd)}
                </span>
                <span
                  className={cn(
                    "hidden text-right font-mono text-data tabular lg:block",
                    (t.market?.priceChange24h ?? 0) > 0
                      ? "text-gain"
                      : (t.market?.priceChange24h ?? 0) < 0
                        ? "text-loss"
                        : "text-faint",
                  )}
                >
                  {t.market?.priceChange24h != null
                    ? `${t.market.priceChange24h >= 0 ? "+" : ""}${t.market.priceChange24h.toFixed(1)}%`
                    : "—"}
                </span>
                <span className="hidden text-right font-mono text-data text-muted lg:block">
                  {countCompact(t.holders)}
                </span>
                <span className="hidden flex-wrap gap-1.5 lg:flex">
                  {t.flags.slice(0, 2).map((f) => {
                    const m = flagMeta(f);
                    return (
                      <Badge key={f} variant={m.variant}>
                        {m.label}
                      </Badge>
                    );
                  })}
                </span>
                <span className="flex items-center justify-end gap-2.5 justify-self-end">
                  <QuickBuy chain={t.chain} address={t.address} />
                  <ScoreWithBreakdown score={t.currentScore} breakdown={t.gateBreakdown} />
                </span>
              </Link>
            </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {loaded && nextOffset !== null && tokens.length > 0 ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more pairs"}
          </Button>
        </div>
      ) : null}

      <p className="mt-4 font-mono text-data-sm text-faint">
        {loaded ? `${tokens.length} shown · ` : ""}Live on-chain pairs · Quant AI
        security gates · fresh contracts show as SCREENING until gates land ·
        refreshes every 10s
      </p>
    </TooltipProvider>
  );
}
