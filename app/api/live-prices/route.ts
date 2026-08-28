import { NextResponse } from "next/server";
import { fetchPoolsForAddresses } from "@/lib/datasources/dexscreener";
import { CHAIN_LIST, normalizeAddress, type ChainId } from "@/lib/chains";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/*
  POST /api/live-prices — current prices for the rows on someone's screen.

  The catalogue is refreshed on a rotation, which is fine for a directory and
  useless for a trading screen: a price that is correct on average but hours
  old for the token you're about to buy is worse than no number at all. This
  reads the market directly for the handful of tokens actually being looked at,
  so the screen ticks even when the stored row hasn't been revisited yet.

  Answers are cached for a few seconds and shared across everyone viewing the
  same tokens, so a hundred people watching one board cost one upstream read.
*/

type Quote = { priceUsd: number; liquidityUsd: number; marketCapUsd: number; at: number };

const cache = new Map<string, Quote>();
const TTL = 4_000;
/* Bound the map so a long-running instance can't grow without limit. */
const MAX_CACHED = 5_000;

function cached(chain: ChainId, address: string): Quote | null {
  const hit = cache.get(`${chain}:${address}`);
  return hit && Date.now() - hit.at < TTL ? hit : null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { tokens?: { chain?: string; address?: string }[] }
    | null;
  const wanted = Array.isArray(body?.tokens) ? body!.tokens!.slice(0, 120) : [];
  if (wanted.length === 0) return NextResponse.json({ prices: {} });

  const out: Record<string, Quote> = {};
  const missing = new Map<ChainId, string[]>();
  /*
    What the catalogue already knows, so a live quote can be checked against
    it. Sources cover different venues, and streaming a price from a pool a
    hundred times shallower than the one the row describes would make the board
    disagree with the token page for the same token.
  */
  const known = new Map<string, number>();

  for (const t of wanted) {
    const chain = String(t?.chain ?? "").toLowerCase() as ChainId;
    if (!CHAIN_LIST.some((c) => c.id === chain)) continue;
    const address = normalizeAddress(chain, String(t?.address ?? ""));
    if (!address) continue;

    const hit = cached(chain, address);
    if (hit) {
      out[`${chain}:${address}`] = hit;
      continue;
    }
    missing.set(chain, [...(missing.get(chain) ?? []), address]);
  }

  if (missing.size > 0) {
    const rows = await prisma.token
      .findMany({
        where: { OR: [...missing.entries()].map(([chain, addrs]) => ({
          chain: chain.toUpperCase() as never,
          address: { in: addrs },
        })) },
        select: { chain: true, address: true, liquidityUsd: true },
      })
      .catch(() => []);
    for (const r of rows) known.set(`${r.chain.toLowerCase()}:${r.address}`, r.liquidityUsd);
  }

  await Promise.all(
    [...missing.entries()].map(async ([chain, addresses]) => {
      const pools = await fetchPoolsForAddresses(chain, addresses).catch(() => []);
      for (const pool of pools) {
        if (!(pool.priceUsd > 0)) continue;
        /*
          A quote from a far shallower venue than the stored one is describing
          a different market. Leaving it out means the row keeps the figure the
          token page shows, which is the honest answer.
        */
        const stored = known.get(`${chain}:${pool.tokenAddress}`);
        if (stored != null && stored > 0 && pool.liquidityUsd < stored * 0.5) continue;
        /*
          Same sanity test the catalogue applies. A live feed that streams an
          implausible number in real time is just a faster way to be wrong.
        */
        const fdv = pool.fdvUsd;
        const believable =
          Number.isFinite(fdv) && fdv > 0 && fdv <= 1e12 &&
          !(pool.liquidityUsd > 0 && fdv / pool.liquidityUsd > 1e5);
        const quote: Quote = {
          priceUsd: pool.priceUsd,
          liquidityUsd: pool.liquidityUsd,
          marketCapUsd: believable ? fdv : 0,
          at: Date.now(),
        };
        const key = `${chain}:${pool.tokenAddress}`;
        cache.set(key, quote);
        out[key] = quote;
      }
    }),
  );

  if (cache.size > MAX_CACHED) {
    // drop the oldest half rather than clearing — keeps hot tokens warm
    const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of entries.slice(0, Math.floor(entries.length / 2))) cache.delete(k);
  }

  return NextResponse.json({ prices: out });
}
