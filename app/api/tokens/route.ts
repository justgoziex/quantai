import { waitUntil } from "@vercel/functions";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable } from "@/lib/api";
import { runIngest } from "@/lib/ingest"; // module import also starts the local background loop
import type { Chain } from "@/lib/generated/prisma/enums";

/*
  GET /api/tokens — the screener feed.
  Query: chain=ETH|BSC|BASE|RH|SOL · category=new|trending|trenching · minLiquidity ·
  minScore · maxAgeMinutes · limit · offset

  Performance: data only changes ~once a minute, so responses are cached two
  ways — a per-instance memory cache (8s) absorbs concurrent pollers, and
  CDN cache headers let Vercel's edge serve repeat hits without invoking the
  function at all.

  On Vercel Hobby, crons only run daily — so this route also kicks a
  background ingest pass via waitUntil (DB-locked + self-throttled).
*/
let lastKick = 0;
const cache = new Map<string, { at: number; body: string }>();
const CACHE_MS = 8_000;
const CACHE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, s-maxage=10, stale-while-revalidate=30",
};

/* One row shape for every token query, so the feeds can't drift apart. */
const TOKEN_FIELDS = {
      id: true,
      chain: true,
      address: true,
      name: true,
      symbol: true,
      dex: true,
      liquidityUsd: true,
      marketCapUsd: true,
      holders: true,
      pairCreatedAt: true,
      currentScore: true,
      gateBreakdown: true,
      flags: true,
      category: true,
      promoted: true,
      promotedUntil: true,
      market: true,
} as const;

const CHAIN_VALUES = ["ETH", "BSC", "BASE", "RH", "SOL"] as const;

export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  if (Date.now() - lastKick > 60_000) {
    lastKick = Date.now();
    waitUntil(runIngest().catch(() => {}));
  }
  const url = new URL(req.url);

  // memory cache — one DB round-trip serves every poller in the window
  const key = url.searchParams.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return new Response(hit.body, { headers: CACHE_HEADERS });
  }

  const chain = url.searchParams.get("chain")?.toUpperCase();
  const category = url.searchParams.get("category");
  const minLiquidity = Number(url.searchParams.get("minLiquidity") ?? 0);
  const minScore = Number(url.searchParams.get("minScore") ?? 0);
  const maxAgeMinutes = Number(url.searchParams.get("maxAgeMinutes") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 60), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  // "Trenching" (axiom-style) is a live age-window view over the WHOLE
  // catalog — memecoins past the first-hour chaos but not yet old (1h–21d) —
  // rather than a stored tag, so it's full immediately instead of waiting for
  // tokens to age into a category. "new"/"trending" stay stored-category feeds.
  const TRENCH_MIN = 60 * 60_000; // 1h
  const TRENCH_MAX = 21 * 24 * 60 * 60_000; // 21d
  const now = Date.now();

  // "Movers" — biggest 24h gainers/losers across the catalog. The change lives
  // in the market JSON, so we pull a liquidity-bounded slice and rank in JS.
  const movers = category === "movers";

  const baseWhere = {
      blacklisted: false,
      ...(category === "new" || category === "trending" ? { category } : {}),
      ...(category === "trenching"
        ? {
            pairCreatedAt: {
              gte: new Date(now - TRENCH_MAX),
              lte: new Date(now - TRENCH_MIN),
            },
            liquidityUsd: { gte: 2_000 }, // skip dust
          }
        : {}),
      ...(movers ? { liquidityUsd: { gte: Math.max(minLiquidity, 5_000) } } : {}),
      // an unknown value must not silently fall through to "all chains"
      ...(chain && ["ETH", "BSC", "BASE", "RH", "SOL"].includes(chain) ? { chain: chain as Chain } : {}),
      ...(!movers && minLiquidity > 0 ? { liquidityUsd: { gte: minLiquidity } } : {}),
      ...(minScore > 0 ? { currentScore: { gte: minScore } } : {}),
      ...(maxAgeMinutes > 0
        ? { pairCreatedAt: { gte: new Date(now - maxAgeMinutes * 60_000) } }
        : {}),
  };

  const tokens = await prisma.token.findMany({
    where: baseWhere,
    // promoted (paid) listings pin to the top; then trending/trenching by
    // liquidity, new by pair age; movers rank in JS after the fetch
    orderBy: [
      { promoted: "desc" },
      category === "trending" || category === "trenching" || movers
        ? { liquidityUsd: "desc" }
        : { pairCreatedAt: "desc" },
    ],
    take: movers ? 400 : limit,
    skip: movers ? 0 : offset,
    select: TOKEN_FIELDS,
  });

  /*
    Collapse copycats.

    Anyone can mint a token called FLOKI, and on Solana hundreds do — the
    catalogue carries 46 distinct FLOKI mints and 24 MEMECATs. Showing them all
    reads as a broken, duplicated feed, and it's the exact confusion a copycat
    is built to exploit. Keep the deepest instance of each symbol and drop the
    imitators, which are near-zero liquidity by definition.
  */
  const bySymbol = new Map<string, (typeof tokens)[number]>();
  for (const t of tokens) {
    const key = `${t.chain}:${t.symbol.toLowerCase()}`;
    const held = bySymbol.get(key);
    if (!held || t.liquidityUsd > held.liquidityUsd) bySymbol.set(key, t);
  }
  const deduped = tokens.filter((t) => bySymbol.get(`${t.chain}:${t.symbol.toLowerCase()}`)?.id === t.id);

  /*
    Round-robin the chains for "New pairs".

    Each chain is asked for its own newest, then they're dealt out one apiece.
    Over-fetching a single global list didn't work: Solana and Robinhood mint
    so much faster that Ethereum's newest pair isn't inside even a wide recency
    window, so Ethereum simply never appeared. Asking each chain separately is
    the only way every chain is represented by what's genuinely newest for it.
  */
  let interleaved = deduped;
  if (category === "new" && !chain) {
    const perChain = await Promise.all(
      CHAIN_VALUES.map((c) =>
        prisma.token.findMany({
          where: { ...baseWhere, chain: c, promoted: false },
          orderBy: { pairCreatedAt: "desc" },
          take: limit,
          select: TOKEN_FIELDS,
        }),
      ),
    );
    const dealt: typeof deduped = deduped.filter((t) => t.promoted);
    for (let i = 0; dealt.length < limit + offset; i++) {
      const before = dealt.length;
      for (const q of perChain) if (q[i]) dealt.push(q[i]);
      if (dealt.length === before) break; // every chain exhausted
    }
    interleaved = dealt.slice(offset, offset + limit);
  }

  let withPromo = interleaved.map((t) => ({
    ...t,
    promoted: t.promoted && (!t.promotedUntil || t.promotedUntil > new Date(now)),
  }));

  if (movers) {
    const chg = (t: (typeof withPromo)[number]) =>
      Number((t.market as { priceChange24h?: number } | null)?.priceChange24h ?? 0);
    withPromo = withPromo
      .filter((t) => chg(t) !== 0)
      .sort((a, b) => chg(b) - chg(a)) // biggest gainers first, losers at the end
      .slice(offset, offset + limit);
  }

  const body = JSON.stringify({
    tokens: withPromo,
    nextOffset: withPromo.length === limit ? offset + limit : null,
  });
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 200) {
    // drop stale entries so the map can't grow unbounded
    for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  }
  return new Response(body, { headers: CACHE_HEADERS });
}
