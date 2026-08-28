import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { streamAnalysis } from "@/lib/ai";
import { fetchOhlcv } from "@/lib/datasources/geckoterminal";
import { analyzeChart } from "@/lib/chart-analysis";
import { fetchTokenLinks } from "@/lib/datasources/dexscreener";
import type { Chain } from "@/lib/generated/prisma/enums";
import { normalizeAddress } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  GET /api/analyze/[chain]/[address] — streaming desk analysis.
  Fresh cache (<3 min) returns JSON instantly; otherwise the readout streams
  as plain text while it's generated, then caches on the token row together
  with the score/price it was written at (so the next run can describe what
  changed — the "how is it behaving" thread).
*/
const CACHE_MS = 3 * 60_000;

const SYSTEM = `You are the house degen at Quant AI — a memecoin gambler with
years on Solana, Ethereum and BNB Chain who has been rugged, front-run, and also hit
the occasional 50x. You sit directly on the chain: every number in the
dossier is live Quant AI data — real-time market data, on-chain security
gates, and our documented 10-gate signal score. Never name external data
providers or tools; it's all Quant AI. You talk like a real trader in the
trenches: blunt, specific, numbers cited inline, zero hype, zero corporate
hedging.

Your whole worldview is EXPECTED VALUE and VARIANCE, not certainty. Memecoins
are gambling: even a clean setup loses most of the time, and even a sketchy
one can moon. You never pretend a call is guaranteed. You frame reads as odds
and payoff — "coin-flip with a fat right tail", "lottery ticket, size it like
one", "structure is a trap dressed as a setup". You're honest when it's just a
gamble, when the edge is thin, and when the only winning move is not to play.
This is analytics for degens, not financial advice — never command "buy" or
"sell"; read the odds and let them pull the trigger.

RESEARCH THE COIN ONLINE before you decide. Use web search to check its X
(Twitter), its website, and what people are saying right now. Weigh what you
find into the read — legitimacy and momentum of the community, whether the
socials are real and active or a copy-paste shell, notable backers or scam
chatter. Weigh the token's AGE and reputation too: a brand-new stealth launch,
a coin that's been around for months, and a well-known name all trade
differently. Reason like the example "this is an old token that already had its
run, so it's a poor quick-trade" or "fresh launch, no history, pure gamble".
If you can't find socials or any web presence, say so — that absence is itself
a signal. Cite what you found briefly; never invent links or facts.

OUTPUT CONTRACT — follow exactly:
Line 1 must be EXACTLY this shape (no markdown, no preamble):
VERDICT: GOOD ENTRY | CONFIDENCE: 61
verdict is one of: GOOD ENTRY, FAIR ENTRY, BAD ENTRY, AVOID — read as a
gambler's odds, not promises:
- GOOD ENTRY = favorable risk/reward, real edge, but it can still lose.
- FAIR ENTRY = genuine coin-flip / lottery ticket — playable small, no edge either way.
- BAD ENTRY = odds against you; momentum or structure is working against a fill here.
- AVOID = structural trap (open mint, unlocked LP + concentration, honeypot-adjacent). Don't play.
Confidence 0-100 is conviction in THE READ, not a profit promise — a
high-confidence GOOD ENTRY still loses plenty; a high-confidence AVOID means
you're sure it's a trap.

Then a blank line, then these markdown sections, each 3-6 punchy sentences
packed with the dossier's actual numbers:

## The play right now
What it's doing this minute: 1h vs 6h vs 24h action, volume vs liquidity,
buy/sell flow, what the candles say about who's in control. If "sinceLastRead"
is present, open with what changed since your last read and whether the setup
got better or worse. Call the vibe — accumulating, dumping, dead, or euphoric.

## The story & the crowd
What your research turns up off-chain: the token's age and reputation, whether
it's a fresh launch / mid-life runner / old name that already ran, and what X
and the website show — real active community vs dead/shell socials, legit
project vs obvious copy. Say plainly how this shapes a quick-trade vs a hold,
and flag "no socials / no web presence" when that's the case.

## What's under the hood
The on-chain skeleton: liquidity depth, LP lock %, taxes, mint/ownership,
holder concentration (name top wallet shares), the gate score composition.
Name the one fact that most decides trade vs trap.

## The bet
Why the verdict is what it is, in EV terms. Where in the move are we, realistic
upside vs realistic hole, how a disciplined degen would size and time this — or
why they'd pass. Say plainly if it's a coin-flip.

## How you get rekt, ranked
The 2-4 concrete ways this bet blows up, worst first, each tied to a dossier
number. Be specific about the rug/dump/bleed mechanics.

## Watch triggers
3-4 checkable triggers (price levels, flow thresholds, holder/liquidity moves)
that flip the read — say which direction each one points.`;

export async function GET(
  _req: Request,
  { params }: { params: { chain: string; address: string } },
) {
  if (!dbConfigured) return dbUnavailable();
  const { isKilled } = await import("@/lib/config");
  if (await isKilled("ai")) {
    return NextResponse.json(
      { error: "AI analysis is temporarily disabled by the operators." },
      { status: 503 },
    );
  }
  const chain = params.chain.toUpperCase();
    if (!["ETH", "BSC", "BASE", "RH", "SOL"].includes(chain)) return badRequest("Unknown chain.");

  const token = await prisma.token.findFirst({
    where: { chain: chain as Chain, // base58 is case-sensitive; only EVM addresses are lowered
      address: normalizeAddress(chain.toLowerCase() as never, params.address), blacklisted: false },
    include: { signals: { orderBy: { firedAt: "desc" }, take: 5 } },
  });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const market = (token.market ?? {}) as Record<string, unknown> & {
    aiAnalysis?: { text: string; at: string; provider?: string; score?: number; priceUsd?: number };
    priceUsd?: number;
  };

  // fresh cache → instant JSON
  const prev = market.aiAnalysis;
  if (prev && Date.now() - new Date(prev.at).getTime() < CACHE_MS) {
    return NextResponse.json({ analysis: prev.text, provider: prev.provider, cached: true, at: prev.at });
  }

  // dossier — full candle series (compressed), multi-window momentum, deltas,
  // plus the token's official links so the model researches the real project
  const [candles, links] = await Promise.all([
    token.pairAddress
      ? fetchOhlcv(chain.toLowerCase() as import("@/lib/chains").ChainId, token.pairAddress).catch(() => [])
      : Promise.resolve([]),
    fetchTokenLinks(chain.toLowerCase() as import("@/lib/chains").ChainId, token.address).catch(() => ({
      websites: [],
      socials: [],
    })),
  ]);
  const recent = candles.slice(-12); // last 3h at full resolution
  const older = candles.slice(0, -12).filter((_, i) => i % 4 === 0); // rest sampled hourly
  const fmtCandle = (c: (typeof candles)[number]) =>
    `${new Date(c.time * 1000).toISOString().slice(11, 16)} o=${c.open.toPrecision(4)} h=${c.high.toPrecision(4)} l=${c.low.toPrecision(4)} c=${c.close.toPrecision(4)} v=${Math.round(c.volume)}`;

  const sinceLastRead = prev
    ? {
        minutesAgo: Math.round((Date.now() - new Date(prev.at).getTime()) / 60_000),
        scoreThen: prev.score ?? null,
        scoreNow: token.currentScore,
        priceThen: prev.priceUsd ?? null,
        priceNow: market.priceUsd ?? null,
        priceChangePctSinceThen:
          prev.priceUsd && market.priceUsd
            ? (((market.priceUsd as number) - prev.priceUsd) / prev.priceUsd) * 100
            : null,
      }
    : null;

  const ageHours = token.pairCreatedAt
    ? (Date.now() - new Date(token.pairCreatedAt).getTime()) / 3_600_000
    : null;

  const dossier = {
    token: `${token.name} (${token.symbol}) on ${token.chain}`,
    contractAddress: token.address,
    dex: token.dex,
    pairAgeHours: ageHours !== null ? ageHours.toFixed(1) : "unknown",
    pairAgeDays: ageHours !== null ? (ageHours / 24).toFixed(1) : "unknown",
    officialLinks: {
      websites: links.websites,
      socials: links.socials,
      note:
        links.websites.length === 0 && links.socials.length === 0
          ? "No official website/socials found on-chain — verify via search; absence is a red flag."
          : "Research these plus X/web for sentiment and legitimacy.",
    },
    liquidityUsd: token.liquidityUsd,
    marketCapUsd: token.marketCapUsd,
    holders: token.holders,
    signalScore: token.currentScore,
    gateBreakdown: token.gateBreakdown,
    flags: token.flags,
    market: {
      priceUsd: market.priceUsd,
      priceChange1hPct: market.priceChange1h,
      priceChange6hPct: market.priceChange6h,
      priceChange24hPct: market.priceChange24h,
      volume1hUsd: market.volume1hUsd,
      volume24hUsd: market.volume24hUsd,
      buys1h: market.buys1h,
      sells1h: market.sells1h,
      buys24h: market.buys24h,
      sells24h: market.sells24h,
      lpLockedPct: market.lpLockedPct,
      buyTaxPct: market.buyTaxPct,
      sellTaxPct: market.sellTaxPct,
      top10HolderSharesPct: market.topHolders,
      dataAsOf: market.at,
    },
    sinceLastRead,
    // the chart structure the signal engine draws on the page — support,
    // resistance, regression trend, and its one-line read. Reference these
    // exact levels so the written analysis matches the lines on the chart.
    chartRead: (() => {
      const a = analyzeChart(candles);
      return a
        ? {
            trend: a.trend.dir,
            supportUsd: a.support,
            resistanceUsd: a.resistance,
            structureNote: a.verdict,
          }
        : "not enough candle history to read structure";
    })(),
    recentSignals: token.signals.map((s) => ({
      type: s.type,
      score: s.score,
      firedAt: s.firedAt,
      reasoning: s.reasoning,
    })),
  };

  const userPrompt =
    `Analyze this token right now.\n\nDOSSIER\n${JSON.stringify(dossier, null, 1)}\n\n` +
    (candles.length
      ? `15-MINUTE CANDLES · LAST 3H FULL RESOLUTION\n${recent.map(fmtCandle).join("\n")}\n\nEARLIER (hourly samples)\n${older.map(fmtCandle).join("\n")}`
      : "No candle history yet — a very fresh pair; weigh that in the entry read.");

  const result = await streamAnalysis(SYSTEM, userPrompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // stream to the client, accumulate, cache when done
  const encoder = new TextEncoder();
  let full = "";
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of result.chunks) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        console.error("analyze stream failed:", (e as Error).message);
        controller.enqueue(encoder.encode("\n\n_Analysis interrupted — hit refresh._"));
      }
      controller.close();
      if (full.trim().length > 100) {
        await prisma.token
          .update({
            where: { id: token.id },
            data: {
              market: {
                ...market,
                aiAnalysis: {
                  text: full,
                  at: new Date().toISOString(),
                  provider: result.provider,
                  score: token.currentScore,
                  priceUsd: market.priceUsd ?? null,
                },
              },
            },
          })
          .catch(() => {});
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-provider": result.provider,
      "cache-control": "no-store",
    },
  });
}
