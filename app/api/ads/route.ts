import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { getMonetization } from "@/lib/config";

export const dynamic = "force-dynamic";

/*
  GET /api/ads — the live ad rotation (DexScreener-style promoted banner).
  Public, cached briefly at the edge. Returns up to `adSlots` active campaigns
  with the token's current price/score so the banner shows real data.
*/
export async function GET() {
  if (!dbConfigured) return NextResponse.json({ ads: [] });
  try {
    const mon = await getMonetization();
    const now = new Date();

    // expire finished campaigns (cheap, keeps the rotation honest)
    await prisma.adCampaign
      .updateMany({ where: { status: "ACTIVE", endsAt: { lt: now } }, data: { status: "ENDED" } })
      .catch(() => {});

    const ads = await prisma.adCampaign.findMany({
      where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(mon.adSlots, 10)),
      select: {
        id: true,
        chain: true,
        tokenAddress: true,
        symbol: true,
        headline: true,
        ctaUrl: true,
        endsAt: true,
      },
    });
    if (ads.length === 0) return NextResponse.json({ ads: [] }, { headers: CACHE });

    // enrich with live market data from the catalog
    const tokens = await prisma.token.findMany({
      where: { address: { in: ads.map((a) => a.tokenAddress) }, blacklisted: false },
      select: { address: true, chain: true, symbol: true, name: true, currentScore: true, liquidityUsd: true, market: true },
    });
    const byKey = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t]));

    return NextResponse.json(
      {
        ads: ads.map((a) => {
          const t = byKey.get(`${a.chain}:${a.tokenAddress}`);
          const m = (t?.market ?? {}) as { priceUsd?: number; priceChange24h?: number };
          return {
            id: a.id,
            chain: a.chain,
            address: a.tokenAddress,
            symbol: t?.symbol ?? a.symbol,
            name: t?.name ?? a.symbol,
            headline: a.headline,
            ctaUrl: a.ctaUrl,
            priceUsd: m.priceUsd ?? null,
            change24h: m.priceChange24h ?? null,
            score: t?.currentScore ?? null,
            liquidityUsd: t?.liquidityUsd ?? null,
          };
        }),
      },
      { headers: CACHE },
    );
  } catch {
    return NextResponse.json({ ads: [] });
  }
}

const CACHE = { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" };
