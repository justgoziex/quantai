import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { fetchTokenSecurity } from "@/lib/datasources/goplus";
import { scoreToken, scoreProvisional, scoreMarketOnly } from "@/lib/scoring";
import type { GtPool } from "@/lib/datasources/geckoterminal";
import { CHAINS, type ChainId } from "@/lib/chains";
import { isSolAddress } from "@/lib/solana";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

/*
  GET /api/lookup?address=0x… — paste-a-CA search.
  Checks the database first; otherwise finds the token's top pool on
  GeckoTerminal (both chains), runs security + scoring, ingests it,
  and returns where to navigate.
*/
const GT = "https://api.geckoterminal.com/api/v2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const GT_NET: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };

async function topPoolFor(chain: ChainId, address: string): Promise<GtPool | null> {
  const net = GT_NET[chain];
  const r = await fetch(`${GT}/networks/${net}/tokens/${address}/pools?page=1`, {
    headers: { accept: "application/json" },
    next: { revalidate: 60 },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const p = j?.data?.[0];
  if (!p) return null;
  const a = p.attributes ?? {};
  return {
    poolAddress: chain === "sol" ? String(a.address ?? "") : String(a.address ?? "").toLowerCase(),
    tokenAddress: address,
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

export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const url = new URL(req.url);
  /*
    Accept either address family. A base58 mint keeps its case; a hex contract
    is lowered so it matches how EVM rows are stored.
  */
  const rawAddress = url.searchParams.get("address")?.trim() ?? "";
  const address = /^0x/i.test(rawAddress) ? rawAddress.toLowerCase() : rawAddress;
  const looksEvm = /^0x[a-f0-9]{40}$/.test(address);
  const looksSol = isSolAddress(address);
  if (!looksEvm && !looksSol) {
    return badRequest("Paste a valid contract address or Solana mint.");
  }

  /*
    Blacklisted first, and it stops here.

    Filtering blacklisted rows out of the "already known" check meant a banned
    token simply fell through to live discovery below and got re-ingested —
    pasting its address brought it straight back. The blacklist has to be
    checked before any rediscovery path, not alongside it.
  */
  const banned = await prisma.token.findFirst({
    where: { address, blacklisted: true },
    select: { chain: true },
  });
  if (banned) {
    return NextResponse.json(
      { error: "That token isn't listed on Quant AI." },
      { status: 404 },
    );
  }

  // already known?
  const existing = await prisma.token.findFirst({
    where: { address, blacklisted: false },
    select: { chain: true, address: true },
  });
  if (existing) {
    return NextResponse.json({
      found: true,
      chain: existing.chain.toLowerCase(),
      address: existing.address,
    });
  }

  /*
    Only scan the chains the address could possibly belong to. A base58 mint is
    Solana and nothing else; a 0x address is EVM and never Solana. That halves
    the work and stops a hex string being hunted for on Solana.
  */
  const CHAINS_TO_SCAN: ChainId[] = looksSol ? ["sol"] : ["eth", "bsc", "base", "rh"];
  const pools = await Promise.all(
    CHAINS_TO_SCAN.map((c) => topPoolFor(c, address).catch(() => null)),
  );
  // prefer the chain with the deepest liquidity when a token exists on several
  let best: { chain: ChainId; pool: GtPool } | null = null;
  for (let i = 0; i < CHAINS_TO_SCAN.length; i++) {
    const p = pools[i];
    if (p && (!best || p.liquidityUsd > best.pool.liquidityUsd)) {
      best = { chain: CHAINS_TO_SCAN[i], pool: p };
    }
  }
  if (!best) {
    return NextResponse.json(
      { error: "No trading pool found for this address on Solana, Ethereum, BNB Chain, Base, or Robinhood." },
      { status: 404 },
    );
  }
  const { chain, pool } = best;

  // chains without security coverage (Robinhood) score on market data alone
  const security = CHAINS[chain].securitySupported
    ? await fetchTokenSecurity(chain, [address]).catch(() => new Map<string, never>())
    : new Map<string, never>();
  const sec = security.get(address);
  const result = sec
    ? scoreToken(sec, pool)
    : CHAINS[chain].securitySupported
      ? scoreProvisional(pool)
      : scoreMarketOnly(pool);
  if (result.disqualified) {
    return NextResponse.json(
      { error: "This token failed the honeypot gate — it is not listed." },
      { status: 422 },
    );
  }

  const [symbol] = pool.name.split("/").map((s) => s.trim());
  await prisma.token.upsert({
    where: { chain_address: { chain: chain.toUpperCase() as Chain, address } },
    update: {},
    create: {
      chain: chain.toUpperCase() as Chain,
      address,
      name: symbol || address.slice(0, 8),
      symbol: (symbol || "?").slice(0, 12),
      pairAddress: pool.poolAddress,
      dex: pool.dex,
      liquidityUsd: pool.liquidityUsd,
      marketCapUsd: pool.fdvUsd,
      holders: sec?.holderCount ?? 0,
      pairCreatedAt: new Date(pool.createdAt),
      currentScore: result.score,
      gateBreakdown: result.breakdown,
      flags: result.flags,
      category: "lookup",
      market: {
        priceUsd: pool.priceUsd,
        buys1h: pool.buys1h,
        sells1h: pool.sells1h,
        buys24h: pool.buys24h,
        sells24h: pool.sells24h,
        priceChange24h: pool.priceChange24h,
        volume24hUsd: pool.volume24hUsd,
        topHolders: sec?.topHolders ?? [],
        lpLockedPct: sec?.lpLockedPct ?? null,
        buyTaxPct: sec?.buyTaxPct ?? null,
        sellTaxPct: sec?.sellTaxPct ?? null,
        source: "geckoterminal+goplus",
        at: new Date().toISOString(),
      },
    },
  });

  return NextResponse.json({ found: true, chain, address });
}
