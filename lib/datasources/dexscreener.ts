/*
  DexScreener public API (no key). Second discovery source next to
  GeckoTerminal — different index, different rate budget (~300 req/min for
  pair lookups, ~60 req/min for profile/boost lists), so it widens the
  catalog without eating GeckoTerminal's ~30 req/min.

  Discovery: token-profiles + token-boosts (paid listings/promotions — dense
  with active memecoins, axiom-style) → batch pair lookup (30 addrs/request).
*/
import { normalizeAddress as norm, type ChainId } from "@/lib/chains";
import type { GtPool } from "./geckoterminal";

const BASE = "https://api.dexscreener.com";
const CHAIN: Record<ChainId, string> = { eth: "ethereum", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };

type DsListEntry = { chainId?: string; tokenAddress?: string };

type DsPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  volume?: { h24?: number; h1?: number; m5?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number; // ms epoch
  info?: {
    imageUrl?: string;
    websites?: { url?: string }[];
    socials?: { type?: string; url?: string }[];
  };
};

export type TokenLinks = {
  websites: string[];
  socials: { type: string; url: string }[];
  imageUrl?: string;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getJson(path: string): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  return r.json();
}

/* Token addresses for one chain from a profile/boost list response. */
function addressesFrom(list: unknown, chain: ChainId): string[] {
  if (!Array.isArray(list)) return [];
  return (list as DsListEntry[])
    .filter((e) => e.chainId === CHAIN[chain] && e.tokenAddress)
    .map((e) => norm(chain, String(e.tokenAddress)));
}

function toPool(p: DsPair): GtPool | null {
  // the pair carries its own chain, and Solana addresses must keep their case
  const isSol = String(p.chainId ?? "").toLowerCase() === "solana";
  const keep = (v?: string) => (v ? (isSol ? v : v.toLowerCase()) : undefined);
  const tokenAddress = keep(p.baseToken?.address);
  const pairAddress = keep(p.pairAddress);
  if (!tokenAddress || !pairAddress) return null;
  return {
    poolAddress: pairAddress,
    tokenAddress,
    name: `${p.baseToken?.symbol ?? "?"} / ${p.quoteToken?.symbol ?? "?"}`,
    dex: String(p.dexId ?? "").replace(/_/g, " "),
    priceUsd: num(p.priceUsd),
    liquidityUsd: num(p.liquidity?.usd),
    volume24hUsd: num(p.volume?.h24),
    fdvUsd: num(p.fdv ?? p.marketCap),
    buys1h: num(p.txns?.h1?.buys),
    buys5m: num(p.txns?.m5?.buys),
    sells5m: num(p.txns?.m5?.sells),
    priceChange5m: num(p.priceChange?.m5),
    volume5mUsd: num(p.volume?.m5),
    sells1h: num(p.txns?.h1?.sells),
    buys24h: num(p.txns?.h24?.buys),
    sells24h: num(p.txns?.h24?.sells),
    priceChange1h: num(p.priceChange?.h1),
    priceChange6h: num(p.priceChange?.h6),
    priceChange24h: num(p.priceChange?.h24),
    volume1hUsd: num(p.volume?.h1),
    createdAt: p.pairCreatedAt
      ? new Date(p.pairCreatedAt).toISOString()
      : new Date().toISOString(),
  };
}

/*
  Discover + resolve DexScreener pools for one chain.
  Returns the best (deepest-liquidity) pair per token, plus which tokens are
  actively boosted (promoted) — a strong "attention" signal for categorizing.
*/
export async function fetchDexScreenerPools(
  chain: ChainId,
): Promise<{ pools: GtPool[]; boosted: Set<string> }> {
  const [profiles, boostsLatest, boostsTop] = await Promise.all([
    getJson("/token-profiles/latest/v1").catch(() => []),
    getJson("/token-boosts/latest/v1").catch(() => []),
    getJson("/token-boosts/top/v1").catch(() => []),
  ]);

  const boosted = new Set([
    ...addressesFrom(boostsLatest, chain),
    ...addressesFrom(boostsTop, chain),
  ]);
  const addrs = Array.from(
    new Set([...addressesFrom(profiles, chain), ...boosted]),
  ).slice(0, 90); // ≤3 batch requests
  if (addrs.length === 0) return { pools: [], boosted };
  return resolvePools(chain, addrs, boosted);
}

/*
  Official links (website, X/Twitter, Telegram) for one token, from the pair's
  `info` block. Lets the AI ground its research in the project's real socials
  instead of guessing or finding impostors.
*/
export async function fetchTokenLinks(
  chain: ChainId,
  tokenAddress: string,
): Promise<TokenLinks> {
  try {
    const res = await getJson(`/tokens/v1/${CHAIN[chain]}/${norm(chain, tokenAddress)}`);
    const pairs: DsPair[] = Array.isArray(res)
      ? (res as DsPair[])
      : ((res as { pairs?: DsPair[] })?.pairs ?? []);
    for (const p of pairs) {
      const info = p.info;
      if (info && ((info.websites?.length ?? 0) > 0 || (info.socials?.length ?? 0) > 0)) {
        return {
          websites: (info.websites ?? []).map((w) => w.url ?? "").filter(Boolean),
          socials: (info.socials ?? [])
            .map((s) => ({ type: s.type ?? "link", url: s.url ?? "" }))
            .filter((s) => s.url),
          imageUrl: info.imageUrl,
        };
      }
    }
  } catch {
    /* no links available */
  }
  return { websites: [], socials: [] };
}

/*
  Current market data for specific tokens, by address.

  Discovery only refreshes what happens to be on the popular pages, so a token
  that drops off them is never priced again. Anything being tracked — a channel
  call, a standing order — has to be able to ask for its own price directly.
*/
export async function fetchPoolsForAddresses(
  chain: ChainId,
  addresses: string[],
): Promise<GtPool[]> {
  if (addresses.length === 0) return [];
  const { pools } = await resolvePools(chain, addresses.slice(0, 60), new Set());
  return pools;
}

async function resolvePools(
  chain: ChainId,
  addrs: string[],
  boosted: Set<string>,
): Promise<{ pools: GtPool[]; boosted: Set<string> }> {
  // batch pair lookup, 30 token addresses per request
  const batches: string[][] = [];
  for (let i = 0; i < addrs.length; i += 30) batches.push(addrs.slice(i, i + 30));
  const responses = await Promise.all(
    batches.map((b) =>
      getJson(`/tokens/v1/${CHAIN[chain]}/${b.join(",")}`).catch(() => []),
    ),
  );

  // best pair per token = deepest liquidity
  const best = new Map<string, GtPool>();
  for (const res of responses) {
    const pairs: DsPair[] = Array.isArray(res)
      ? (res as DsPair[])
      : ((res as { pairs?: DsPair[] })?.pairs ?? []);
    for (const raw of pairs) {
      if (raw.chainId !== CHAIN[chain]) continue;
      const pool = toPool(raw);
      if (!pool || pool.liquidityUsd <= 0) continue;
      const prev = best.get(pool.tokenAddress);
      if (!prev || pool.liquidityUsd > prev.liquidityUsd) best.set(pool.tokenAddress, pool);
    }
  }
  return { pools: [...best.values()], boosted };
}
