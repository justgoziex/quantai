/*
  GeckoTerminal public API (no key, ~30 req/min).
  Networks: eth, bsc. Used for new-pool discovery and OHLCV.
*/
import { normalizeAddress as norm, type ChainId } from "@/lib/chains";

const BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };

export type GtPool = {
  poolAddress: string;
  tokenAddress: string;
  name: string; // "SYMBOL / WETH"
  dex: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd: number;
  buys1h: number;
  sells1h: number;
  buys24h: number;
  sells24h: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume1hUsd: number;
  // 5-minute window — powers the top row of the channel call card
  buys5m: number;
  sells5m: number;
  priceChange5m: number;
  volume5mUsd: number;
  createdAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* Freshly created pairs — the "New" feed. GeckoTerminal caps this at page 10. */
export async function fetchNewPools(chain: ChainId, pages = 10): Promise<GtPool[]> {
  return fetchPoolsPaged(chain, "new_pools", pages);
}

/* Established tokens with current volume — the "Trending" feed. */
export async function fetchTrendingPools(chain: ChainId, pages = 10): Promise<GtPool[]> {
  return fetchPoolsPaged(chain, "trending_pools", pages);
}

/*
  Top pools by liquidity/volume on the network — the deep bench of active
  tokens beyond just "new" and "trending". This is the main lever for a big
  catalog: ~20/page up to page 10 per network.
*/
export async function fetchTopPools(chain: ChainId, pages = 10): Promise<GtPool[]> {
  return fetchPoolsPaged(chain, "pools", pages);
}

/*
  Fetch several pages (GeckoTerminal paginates ~20/page, up to page 10).
  Requests are chunked with a small delay so we stay friendly to the free
  tier's ~30 req/min limit instead of firing every page at once (which draws
  429s). Failed pages resolve to [] and are simply skipped.
*/
async function fetchPoolsPaged(chain: ChainId, path: string, pages: number): Promise<GtPool[]> {
  const total = Math.min(Math.max(1, pages), 10); // GT hard-caps at page 10
  const CHUNK = 4;
  const flat: GtPool[] = [];
  for (let start = 0; start < total; start += CHUNK) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CHUNK, total - start) }, (_, i) =>
        fetchPools(chain, path, start + i + 1).catch(() => [] as GtPool[]),
      ),
    );
    flat.push(...batch.flat());
    if (start + CHUNK < total) await sleep(350);
  }
  // dedup by pool address, preserving order
  const seen = new Set<string>();
  const out: GtPool[] = [];
  for (const pool of flat) {
    if (seen.has(pool.poolAddress)) continue;
    seen.add(pool.poolAddress);
    out.push(pool);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPools(chain: ChainId, path: string, page = 1): Promise<GtPool[]> {
  const r = await fetch(`${BASE}/networks/${NETWORK[chain]}/${path}?page=${page}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  const j = await r.json();
  return mapPools(chain, j.data);
}

/*
  Turn a pool list into GtPools. Shared by the paged feeds and the by-token
  lookup so a token pulled in on demand is shaped exactly like one discovered
  by a sweep — a second mapper here would drift and score differently.
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPools(chain: ChainId, data: any): GtPool[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).flatMap((p: any) => {
    const a = p.attributes ?? {};
    const baseId: string = p.relationships?.base_token?.data?.id ?? "";
    const tokenAddress = norm(chain, baseId.split("_")[1] ?? "");
    if (!tokenAddress || !a.address) return [];
    return [
      {
        poolAddress: norm(chain, String(a.address)),
        tokenAddress,
        name: String(a.name ?? ""),
        dex: String(p.relationships?.dex?.data?.id ?? "").replace(/_/g, " "),
        priceUsd: num(a.base_token_price_usd),
        liquidityUsd: num(a.reserve_in_usd),
        volume24hUsd: num(a.volume_usd?.h24),
        fdvUsd: num(a.fdv_usd),
        buys1h: num(a.transactions?.h1?.buys),
        sells1h: num(a.transactions?.h1?.sells),
        buys24h: num(a.transactions?.h24?.buys),
        sells24h: num(a.transactions?.h24?.sells),
        priceChange1h: num(a.price_change_percentage?.h1),
        priceChange6h: num(a.price_change_percentage?.h6),
        priceChange24h: num(a.price_change_percentage?.h24),
        volume1hUsd: num(a.volume_usd?.h1),
        buys5m: num(a.transactions?.m5?.buys),
        sells5m: num(a.transactions?.m5?.sells),
        priceChange5m: num(a.price_change_percentage?.m5),
        volume5mUsd: num(a.volume_usd?.m5),
        createdAt: String(a.pool_created_at ?? new Date().toISOString()),
      } satisfies GtPool,
    ];
  });
}

/*
  Every pool for one token.

  The sweeps only see what is new, trending or top, so a token that is none of
  those is invisible no matter how real it is — five months old, modest
  liquidity, steady volume. This is the path that can still find it, given the
  address.
*/
export async function fetchTokenPools(chain: ChainId, tokenAddress: string): Promise<GtPool[]> {
  const r = await fetch(
    `${BASE}/networks/${NETWORK[chain]}/tokens/${tokenAddress}/pools`,
    { headers: { accept: "application/json" }, next: { revalidate: 30 } },
  );
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return mapPools(chain, j?.data);
}

/* One pool by address — used by the per-token refresh. */
export async function fetchPool(chain: ChainId, poolAddress: string): Promise<GtPool | null> {
  const r = await fetch(`${BASE}/networks/${NETWORK[chain]}/pools/${poolAddress}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 20 },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const p = j?.data;
  if (!p) return null;
  const a = p.attributes ?? {};
  const baseId: string = p.relationships?.base_token?.data?.id ?? "";
  const tokenAddress = norm(chain, baseId.split("_")[1] ?? "");
  if (!tokenAddress) return null;
  return {
    poolAddress: norm(chain, String(a.address ?? poolAddress)),
    tokenAddress,
    name: String(a.name ?? ""),
    dex: String(p.relationships?.dex?.data?.id ?? "").replace(/_/g, " "),
    priceUsd: num(a.base_token_price_usd),
    liquidityUsd: num(a.reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    fdvUsd: num(a.fdv_usd),
    buys1h: num(a.transactions?.h1?.buys),
    sells1h: num(a.transactions?.h1?.sells),
    buys24h: num(a.transactions?.h24?.buys),
    sells24h: num(a.transactions?.h24?.sells),
    priceChange1h: num(a.price_change_percentage?.h1),
    priceChange6h: num(a.price_change_percentage?.h6),
    priceChange24h: num(a.price_change_percentage?.h24),
    volume1hUsd: num(a.volume_usd?.h1),
    buys5m: num(a.transactions?.m5?.buys),
    sells5m: num(a.transactions?.m5?.sells),
    priceChange5m: num(a.price_change_percentage?.m5),
    volume5mUsd: num(a.volume_usd?.m5),
    createdAt: String(a.pool_created_at ?? new Date().toISOString()),
  };
}

export type GtCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/*
  OHLCV by timeframe. GeckoTerminal exposes day/hour/minute with an aggregate
  multiplier — we map the UI's timeframes onto them:
    live → 1m   ·  15m → 15m  ·  1h → 1h  ·  6h → 6h  ·  24h → 1d
  Returns [] when the pool is unknown.
*/
export type Timeframe = "live" | "15m" | "1h" | "6h" | "24h";
const TF_MAP: Record<Timeframe, { unit: "minute" | "hour" | "day"; aggregate: number; limit: number }> = {
  live: { unit: "minute", aggregate: 1, limit: 120 }, // last ~2h, fine-grained
  "15m": { unit: "minute", aggregate: 15, limit: 96 }, // 24h
  "1h": { unit: "hour", aggregate: 1, limit: 168 }, // 7d
  "6h": { unit: "hour", aggregate: 6, limit: 120 }, // 30d
  "24h": { unit: "day", aggregate: 1, limit: 120 }, // ~4mo
};

export async function fetchOhlcv(
  chain: ChainId,
  poolAddress: string,
  timeframe: Timeframe = "15m",
): Promise<GtCandle[]> {
  const tf = TF_MAP[timeframe] ?? TF_MAP["15m"];
  const r = await fetch(
    `${BASE}/networks/${NETWORK[chain]}/pools/${poolAddress}/ohlcv/${tf.unit}?aggregate=${tf.aggregate}&limit=${tf.limit}¤cy=usd`,
    { headers: { accept: "application/json" }, next: { revalidate: 60 } },
  );
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([t, o, h, l, c, v]) => ({ time: t, open: o, high: h, low: l, close: c, volume: v }))
    .sort((a, b) => a.time - b.time);
}
