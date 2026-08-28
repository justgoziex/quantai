import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/product/empty-state";
import { SignalScore } from "@/components/product/signal-score";
import { TokenChart } from "@/components/token/token-chart";
import { AiPanel } from "@/components/token/ai-panel";
import { LiveRefresh } from "@/components/token/live-refresh";
import { PressurePanel, HoldersPanel } from "@/components/token/side-panels";
import { TradePanel } from "@/components/token/trade-panel";
import { TokenWatch } from "@/components/token/token-watch";
import { CopyLink } from "@/components/token/copy-link";
import { PriceAlertButton } from "@/components/token/price-alert-button";
import { ChainLogo } from "@/components/brand/chain-logo";
import { AdBanner } from "@/components/ads/ad-banner";
import { getLocale, tt } from "@/lib/i18n-server";
import { prisma, dbConfigured } from "@/lib/db";
import { CHAINS, type ChainId } from "@/lib/chains";
import { priceFmt } from "@/lib/mock-series";
import { usdCompact, countCompact, age } from "@/lib/format";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { getSiteUrl, SITE } from "@/lib/site";
import { getMonetization } from "@/lib/config";

/* Plain-English one-liner for the always-on current reading. */
function describeReading(
  score: number,
  flags: string[],
  gates: Record<string, number> | null,
): string {
  const parts: string[] = [];
  if (flags.includes("SCREENING")) {
    return "Security screening is still pending for this contract — the score is provisional (market gates only, capped at 30) until the safety gates finish. Re-check in a few minutes.";
  }
  if (flags.includes("UNVERIFIED")) {
    return "This chain has no security coverage yet, so the score reflects market activity only (liquidity, momentum, trend) and can't verify honeypot, LP, mint, or tax. Treat structure as unconfirmed and size accordingly.";
  }
  if (flags.includes("RUGCHECKED")) {
    return "Rug-checked: a live sell simulation ran against this contract and passed — the sell path and taxes are real readings. Registry gates (LP lock, mint, holders) are still pending, so the score is capped at 65 until the full ten-gate read lands.";
  }
  if (score >= 70) parts.push("Structure reads strong");
  else if (score >= 40) parts.push("Structure reads neutral — tradeable but flawed");
  else parts.push("Structure reads weak");

  if (gates) {
    const weakest = Object.entries(gates).sort((a, b) => a[1] - b[1])[0];
    const strongest = Object.entries(gates).sort((a, b) => b[1] - a[1])[0];
    if (strongest) parts.push(`best gate: ${strongest[0]} (+${strongest[1]})`);
    if (weakest) parts.push(`weakest gate: ${weakest[0]} (${weakest[1] >= 0 ? "+" : ""}${weakest[1]})`);
  }
  if (flags.includes("MINT_OPEN")) parts.push("open mint authority caps the score at 40");
  if (flags.some((f) => f.startsWith("TOP10_"))) parts.push("holder concentration is elevated");
  return parts.join(" · ") + ".";
}
import { cn } from "@/lib/utils";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

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
  UNVERIFIED: { variant: "warn", label: "Unverified security" },
};
function flagMeta(flag: string) {
  if (FLAG_META[flag]) return FLAG_META[flag];
  if (flag.startsWith("TOP10_"))
    return { variant: "warn" as const, label: `Top10 ${flag.slice(6).replace("PCT", "%")}` };
  if (flag.startsWith("TAX_"))
    return { variant: "warn" as const, label: `Tax ${flag.slice(4).replace("PCT", "%")}` };
  return { variant: "neutral" as const, label: flag.toLowerCase().replace(/_/g, " ") };
}

async function getToken(chainParam: string, address: string) {
  const chain = chainParam.toUpperCase();
  if (!["ETH", "BSC", "BASE", "RH", "SOL"].includes(chain) || !dbConfigured) return null;
  /*
    Blacklisted rows are fetched too, but only to render the "not listed yet"
    state below — none of their market data is shown, and the page stays out of
    the index until the token's developer lists it.
  */
  const where = {
    chain: chain as Chain,
    // base58 is case-sensitive, so only EVM addresses get lowered
    address: chain === "SOL" ? address : address.toLowerCase(),
  };
  const include = { signals: { orderBy: { firedAt: "desc" as const }, take: 20 } };

  const found = await prisma.token.findFirst({ where, include });
  if (found) return found;

  /*
    Not stored — try to fetch it before giving up.

    Discovery only asks the feeds for what is new, trending or top, so a real
    token that is none of those has no way in. Someone arriving with the address
    already knows it exists; answering "no such token" is wrong, and the only
    thing missing is that nothing ever proposed it.

    Capped, because this runs inside a page render and the feeds can stall. On
    timeout the page falls through to its normal not-found state rather than
    hanging.
  */
  const { lookupAndIngest } = await import("@/lib/token-lookup");
  const pulled = await Promise.race([
    lookupAndIngest(chain.toLowerCase() as ChainId, address).then((r) => r.ok),
    new Promise<boolean>((r) => setTimeout(() => r(false), 12_000)),
  ]).catch(() => false);

  return pulled ? prisma.token.findFirst({ where, include }) : null;
}

export async function generateMetadata({
  params,
}: {
  params: { chain: string; address: string };
}): Promise<Metadata> {
  const token = await getToken(params.chain, params.address);
  if (!token || token.blacklisted) return { title: "Token", robots: { index: false, follow: true } };

  const chainName = CHAINS[token.chain.toLowerCase() as ChainId]?.name ?? token.chain;
  const market = (token.market ?? {}) as { priceUsd?: number };
  const price = market.priceUsd ? `$${market.priceUsd.toPrecision(4)}` : "—";
  const path = `/token/${token.chain.toLowerCase()}/${token.address}`;
  const title = `${token.name} (${token.symbol}) price, chart & safety score · ${chainName}`;
  const description =
    `${token.name} (${token.symbol}) on ${chainName}: live price ${price}, ` +
    `${usdCompact(token.liquidityUsd)} liquidity, Quant AI safety score ${token.currentScore}/100 ` +
    `from ten on-chain risk gates (honeypot, LP lock, mint, holder concentration). ` +
    `Live chart and signals. Analytics, not financial advice.`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title,
      description,
      url: `${getSiteUrl()}${path}`,
      siteName: SITE.name,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

const SIGNAL_BADGE: Record<string, BadgeProps["variant"]> = {
  ENTRY: "amber",
  EXIT: "warn",
  RISK: "loss",
};

export default async function TokenDetailPage({
  params,
}: {
  params: { chain: string; address: string };
}) {
  if (!dbConfigured) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-wrap px-6 py-16">
          <EmptyState
            label="Token detail"
            title="Database not configured"
            description="Set DATABASE_URL and run the migrations to browse token detail pages."
            action={
              <Button variant="secondary" asChild>
                <Link href="/screener">Back to screener</Link>
              </Button>
            }
          />
        </main>
        <Footer />
      </>
    );
  }

  const token = await getToken(params.chain, params.address);
  if (!token) notFound();

  /*
    Not on Quant AI yet. No price, score, or chart — nothing here is vouched
    for until the token's own developer lists it, which clears this state.
  */
  if (token.blacklisted) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-wrap px-6 py-16">
          <EmptyState
            label={token.symbol}
            title="Not deployed on Quant AI yet"
            description="Its developer hasn't deployed it."
            action={
              <Button variant="secondary" asChild>
                <Link href="/screener">Screener</Link>
              </Button>
            }
          />
        </main>
        <Footer />
      </>
    );
  }

  const monetization = await getMonetization();
  const locale = await getLocale();

  const chainInfo = CHAINS[token.chain.toLowerCase() as ChainId];
  const topFlag = token.flags.find((f) => f.startsWith("TOP10_"));
  const topShare = topFlag ? parseInt(topFlag.slice(6), 10) / 100 : undefined;

  const market = (token.market ?? null) as {
    priceUsd?: number;
    buys1h?: number;
    sells1h?: number;
    priceChange24h?: number;
    topHolders?: number[];
  } | null;

  /*
    No invented data.

    This page used to fall back to a generated series when a pool had no
    history — synthetic candles, and with them a synthetic price, change and
    trade counts. Because the generator is seeded from the address, two
    unrelated tokens with no history rendered charts that looked plausible,
    were completely fictional, and gave no sign of it. On a screen people trade
    from, an invented chart is the most damaging thing the site could show.

    Anything the market hasn't told us is now absent, and reads as "—".
  */
  const isLive = Boolean(market);

  const change = market?.priceChange24h ?? null;
  const price = market?.priceUsd ?? null;
  const buys = market?.buys1h ?? 0;
  const sells = market?.sells1h ?? 0;
  const topHolders =
    market?.topHolders && market.topHolders.length > 0
      ? market.topHolders.map((pct, i) => ({ label: `#${i + 1}`, pct }))
      : [];

  const markers = token.signals.map((s) => ({
    time: Math.floor(new Date(s.firedAt).getTime() / 1000),
    type: s.type,
  }));

  const stats: [string, string][] = [
    ["Liquidity", usdCompact(token.liquidityUsd)],
    ["Market cap", usdCompact(token.marketCapUsd)],
    ["Holders", countCompact(token.holders)],
    ["Pair age", age(token.pairCreatedAt)],
    ["DEX", token.dex ?? "—"],
  ];

  const chainName = CHAINS[token.chain.toLowerCase() as ChainId]?.name ?? token.chain;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `${token.name} (${token.symbol})`,
    category: "Cryptocurrency token",
    url: `${getSiteUrl()}/token/${token.chain.toLowerCase()}/${token.address}`,
    description: `${token.name} (${token.symbol}) on ${chainName} — live price, liquidity, holders, and a transparent Quant AI safety score.`,
    provider: { "@type": "Organization", name: SITE.name, url: getSiteUrl() },
    ...(price ? { offers: { "@type": "Offer", price, priceCurrency: "USD" } } : {}),
  };

  return (
    <>
      <Nav />
      <LiveRefresh chain={token.chain.toLowerCase()} address={token.address} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        {/* header */}
        <header className="border-b border-line py-8">
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            <p className="text-label">
              <Link href="/screener" className="rounded hover:text-bone">
                Screener
              </Link>{" "}
              / {token.chain} · {chainInfo.dex}
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="flex items-center gap-3 text-display-lg text-bone">
                <ChainLogo chain={token.chain} size={32} />
                {token.name} <span className="text-muted">({token.symbol})</span>
              </h1>
              <p className="mt-1 font-mono text-data-sm text-faint">
                {token.address}
                {chainInfo?.explorer ? (
                  <>
                    {" · "}
                    <a
                      href={`https://${chainInfo.explorer}/token/${token.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded underline-offset-4 hover:text-muted hover:underline"
                    >
                      {tt(locale, "View on explorer")}
                    </a>
                  </>
                ) : null}
                {" · "}
                <CopyLink />
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {token.flags.map((f) => {
                  const m = flagMeta(f);
                  return (
                    <Badge key={f} variant={m.variant}>
                      {m.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="flex items-start gap-5">
              <div className="text-right">
                <p className="font-mono text-data-lg tabular text-bone">
                  {price == null ? "—" : priceFmt(price)}
                </p>
                <p
                  className={cn(
                    "font-mono text-data tabular",
                    change == null ? "text-faint" : change >= 0 ? "text-gain" : "text-loss",
                  )}
                >
                  {change == null ? "no 24h data" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% · 24h`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <SignalScore score={token.currentScore} />
                <PriceAlertButton tokenId={token.id} priceUsd={price ?? null} />
                <TokenWatch tokenId={token.id} />
              </div>
            </div>
          </div>
        </header>

        <AdBanner className="mt-6" />

        {/* stats strip */}
        <div className="grid grid-cols-2 border-b border-line sm:grid-cols-5">
          {stats.map(([k, v], i) => (
            <div key={k} className={cn("px-1 py-4", i > 0 && "sm:border-l sm:border-line sm:pl-5")}>
              <p className="text-label mb-1">{k}</p>
              <p className="font-mono text-data tabular text-bone">{v}</p>
            </div>
          ))}
        </div>

        {/* chart + rail */}
        <div className="grid items-start gap-4 pt-6 lg:grid-cols-[2fr_1fr]">
          <TokenChart
            chain={token.chain.toLowerCase()}
            pool={isLive ? token.pairAddress : null}
            address={token.address}
            tokenId={token.id}
            fallbackCandles={[]}
            liquidity={[]}
            markers={markers}
          />
          <div className="flex flex-col gap-4">
            {chainInfo?.tradable ? (
              <TradePanel
                chain={token.chain.toLowerCase()}
                address={token.address}
                tokenId={token.id}
                symbol={token.symbol}
                priceUsd={market?.priceUsd ?? null}
                dex={token.dex ?? undefined}
                swapFeeBps={monetization.swapFeeBps}
                feeWallet={monetization.feeWallet}
              />
            ) : (
              <div className="rounded-md border border-line bg-panel px-4 py-4 text-sm text-muted">
                In-app trading isn&rsquo;t available on {chainInfo?.name ?? "this chain"} yet —
                this token is screened and scored for research only.
              </div>
            )}
            <PressurePanel buys={buys} sells={sells} />
            <HoldersPanel holders={token.holders} topHolders={topHolders} />
          </div>
        </div>

        {/* AI desk analysis */}
        <div className="pt-4">
          <AiPanel chain={token.chain.toLowerCase()} address={token.address} />
        </div>

        {/* signals */}
        <section className="pt-10">
          <h2 className="text-h1 mb-5 text-bone">Signal history</h2>
          {/* current reading — always present, computed from the live gates */}
          <article className="mb-3 rounded-md border border-line bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Badge variant="bone">CURRENT READING</Badge>
                <span className="font-mono text-data-sm text-muted">
                  score {token.currentScore} · updated <LiveTimeAgo date={token.updatedAt} />
                </span>
              </div>
              <SignalScore score={token.currentScore} size="sm" />
            </div>
            <p className="px-4 py-3.5 text-sm text-muted">
              {describeReading(token.currentScore, token.flags, token.gateBreakdown as Record<string, number> | null)}
            </p>
          </article>
          {token.signals.length === 0 ? (
            <p className="px-1 py-2 text-sm text-faint">
              No discrete signals yet — entries fire at score ≥70 with strong buy
              pressure, exits on 25-point drops. The reading above updates with
              every ingest pass.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {token.signals.map((s) => (
                <article key={s.id} className="rounded-md border border-line bg-panel">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Badge variant={SIGNAL_BADGE[s.type] ?? "neutral"}>{s.type}</Badge>
                      <span className="font-mono text-data-sm text-muted">
                        score {s.score} · <LiveTimeAgo date={s.firedAt} />
                      </span>
                    </div>
                  </div>
                  <p className="px-4 py-3.5 text-sm text-muted">
                    <span className="text-bone">Why: </span>
                    {s.reasoning}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="mt-10 font-mono text-data-sm text-faint">
          {isLive
            ? "Live on-chain data · Quant AI candles + security gates · liquidity history estimated"
            : "Seeded sample token · chart and holder series are simulated"}
        </p>
      </main>
      <Footer />
    </>
  );
}
