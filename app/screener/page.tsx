import type { Metadata } from "next";
import { prisma, dbConfigured } from "@/lib/db";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { AdBanner } from "@/components/ads/ad-banner";
import { ScreenerClient } from "@/components/screener/screener-client";
import { SearchBox } from "@/components/screener/search-box";

export const metadata: Metadata = {
  alternates: { canonical: "/screener" },
  title: "Screener",
  description:
    "Live new-pair feed for Solana, Ethereum, Base and BNB Chain with risk flags and 0–100 signal scores.",
};

/*
  The first page of rows is rendered on the server so the feed is visible
  immediately — the client bundle (wallet SDK, charts) can take several
  seconds to hydrate, and we don't want an empty table until it does.
*/
async function initialTokens() {
  if (!dbConfigured) return [];
  try {
    return await prisma.token.findMany({
      where: { blacklisted: false, category: "new" },
      orderBy: [{ promoted: "desc" }, { pairCreatedAt: "desc" }],
      take: 60,
      select: {
        id: true, chain: true, address: true, name: true, symbol: true, dex: true,
        liquidityUsd: true, marketCapUsd: true, holders: true, pairCreatedAt: true,
        currentScore: true, gateBreakdown: true, flags: true, promoted: true, market: true,
      },
    });
  } catch {
    return [];
  }
}

export default async function ScreenerPage() {
  const seed = await initialTokens();
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line py-10">
          <div>
            <p className="text-label mb-3">Screener</p>
            <h1 className="text-display-lg text-bone">Every pair, scored as it lands</h1>
          </div>
          <SearchBox />
        </header>
        <div className="pt-8">
          <AdBanner className="mb-4" />
          <ScreenerClient initialTokens={JSON.parse(JSON.stringify(seed))} />
        </div>
      </main>
      <Footer />
    </>
  );
}
