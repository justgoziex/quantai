import { prisma } from "@/lib/db";
import { getChannelConfig, type ChannelConfig } from "@/lib/config";
import { getNativeUsd, nativeUsdFor } from "@/lib/native-price";
import { fetchTokenLinks, fetchPoolsForAddresses } from "@/lib/datasources/dexscreener";
import { CHAINS, type ChainId } from "@/lib/chains";
import { getSiteUrl } from "@/lib/site";
import { postToChannel, type Keyboard } from "./telegram";
import type { Chain } from "@/lib/generated/prisma/enums";

/*
  Channel calls — the bot posts a call card to the Quant AI channel when the
  engine fires a high-conviction ENTRY, then threads a reply every time that
  call clears a gain multiple (2x, 3x, 5x…).

  Only gains are announced. A call that goes nowhere is simply never updated,
  which is what the desk asked for.

  Everything here is best-effort: a Telegram outage must never break the ingest
  pass that triggered it.
*/

const BOT_HANDLE = process.env.TELEGRAM_BOT_HANDLE ?? "Quantniumaibot";

/* Compact USD, matching the $656k / $1.3M style of the card. */
function usdc(v: number): string {
  const n = Number(v) || 0;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toFixed(0)}`;
}

/* Full precision for sub-cent prices — $0.000006556, not $0.00. */
function priceStr(p: number): string {
  const n = Number(p) || 0;
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(Math.min(18, Math.max(6, Math.ceil(-Math.log10(n)) + 3)))}`.replace(/0+$/, "");
}

function pct(v: number): string {
  const n = Number(v) || 0;
  return `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(2)}%`;
}

/* 中文 age: 5 个月前 / 8 天前 / 3 小时前 / 12 分钟前 */
function ageZh(created: Date | null): string {
  if (!created) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - created.getTime()) / 60_000));
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/* Green through red by score — the dot that opens the card. */
function dot(score: number | null): string {
  if (score == null) return "⚪";
  if (score >= 80) return "🟢";
  if (score >= 65) return "🟡";
  if (score >= 45) return "🟠";
  return "🔴";
}

const CHAIN_TAG: Record<ChainId, string> = {
  eth: "Ethereum",
  bsc: "BNB",
  base: "Base",
  rh: "Robinhood",
  sol: "Solana",
};

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/*
  DEX ids arrive machine-shaped and chain-suffixed ("uniswap-v3-base"). The card
  wants what a trader would say: "uniswap v3".
*/
function dexLabel(dex: string, chain: ChainId): string {
  const suffix = new RegExp(`[-_\\s](${chain}|eth|ethereum|bsc|bnb|base|robinhood)$`, "i");
  return (dex || "")
    .trim()
    .replace(suffix, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/*
  Right-align a column the way the card's monospace block does. Telegram
  renders <pre> in a fixed-width font, so padding lines up visually.
*/
const padStart = (s: string, w: number) => (s.length >= w ? s : " ".repeat(w - s.length) + s);

export type CallToken = {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  score: number | null;
  priceUsd: number;
  mcapUsd: number;
  liquidityUsd: number;
  dex: string;
  pairCreatedAt: Date | null;
  creatorPct: number | null;
  rows: { label: string; change: number; volume: number; buys: number; sells: number }[];
};

/*
  The call card. Layout mirrors the desk's reference exactly: header, the four
  headline stats, a monospace 涨幅/交易量/买/卖 block for 5M/1H/1D, age + deployer
  holding, official links, then the contract address.
*/
export async function buildCallCard(
  t: CallToken,
  cfg: ChannelConfig,
): Promise<{ text: string; keyboard: Keyboard }> {
  const native = await getNativeUsd().catch(() => ({ eth: 0, bnb: 0, sol: 0 }));
  const nativePx = nativeUsdFor(t.chain, native);
  const wrapped = CHAINS[t.chain].wrapped;
  const liqNative = nativePx > 0 ? t.liquidityUsd / nativePx : 0;

  const links = await fetchTokenLinks(t.chain, t.address).catch(() => ({ websites: [], socials: [] }));
  const urls = [...links.websites, ...links.socials.map((s) => s.url)].filter(Boolean).slice(0, 5);

  // monospace stats block — widths chosen so the three rows align
  const header = `      涨幅      交易量    买/卖`;
  const body = t.rows
    .map(
      (r) =>
        `${padStart(r.label + ":", 4)} ${padStart(pct(r.change), 8)} ${padStart(usdc(r.volume), 8)} ${padStart(
          `${r.buys}/${r.sells}`,
          9,
        )}`,
    )
    .join("\n");

  const lines = [
    `${dot(t.score)}<b>${esc(t.name)} ($${esc(t.symbol)})</b> | 🌐<b>#${CHAIN_TAG[t.chain]}</b>`,
    `价格: ${priceStr(t.priceUsd)}`,
    `市值: ${usdc(t.mcapUsd)}`,
    `流动性: ${usdc(t.liquidityUsd)}${liqNative > 0 ? ` <b>(${liqNative.toFixed(1)} ${wrapped})</b>` : ""}`,
    `交易所: ${esc(dexLabel(t.dex, t.chain) || "—")}`,
    `评分: <b>${t.score == null ? "—" : `${t.score}/100`}</b>`,
    "",
    `<pre>${header}\n${body}</pre>`,
    "",
    `🕐<b>创建时间</b>: ${ageZh(t.pairCreatedAt)}`,
    `🎒<b>合约代币</b>: ${t.creatorPct == null ? "—" : `${t.creatorPct.toFixed(2)}%`}`,
  ];

  if (urls.length > 0) {
    lines.push("", "<b>链接:</b>", ...urls.map((u) => esc(u)));
  }

  const site = getSiteUrl();
  const tokenUrl = `${site}/token/${t.chain}/${t.address}`;
  lines.push(
    "",
    `CA: <code>${t.address}</code>`,
    "",
    `<a href="${tokenUrl}">Quant AI</a> | <a href="${tokenUrl}">图表</a> | <a href="https://t.me/${BOT_HANDLE}?start=buy_${t.chain}_${t.address}">买入</a>`,
  );

  const keyboard: Keyboard = [
    [
      { text: `💰 买入 ${t.symbol}`, url: `https://t.me/${BOT_HANDLE}?start=buy_${t.chain}_${t.address}` },
      { text: "📊 详情", url: tokenUrl },
    ],
  ];

  // paid banner: an active campaign wins, else the desk's own house ad
  const ad = await nextAd().catch(() => null);
  if (ad) {
    keyboard.push([{ text: `📣 ${ad.text}`, url: ad.url }]);
  } else if (cfg.adText && cfg.adUrl) {
    keyboard.push([{ text: `📣 ${cfg.adText}`, url: cfg.adUrl }]);
  } else {
    keyboard.push([{ text: "📣 广告位招租？联系我们", url: `${site}/developers/promote` }]);
  }

  return { text: lines.join("\n"), keyboard };
}

/*
  Next paid ad in the rotation. Round-robins by picking the active campaign
  that has been shown least, so every buyer gets channel exposure.
*/
async function nextAd(): Promise<{ text: string; url: string } | null> {
  const now = new Date();
  const ad = await prisma.adCampaign.findFirst({
    where: { status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    orderBy: [{ impressions: "asc" }, { createdAt: "asc" }],
    select: { id: true, symbol: true, headline: true, ctaUrl: true, chain: true, tokenAddress: true },
  });
  if (!ad) return null;
  await prisma.adCampaign
    .update({ where: { id: ad.id }, data: { impressions: { increment: 1 } } })
    .catch(() => {});
  return {
    text: ad.headline?.slice(0, 60) || `$${ad.symbol}`,
    url:
      ad.ctaUrl ||
      `${getSiteUrl()}/token/${ad.chain.toLowerCase()}/${ad.tokenAddress}`,
  };
}

/* Rows for the stats block, straight from the stored market snapshot. */
function statRows(m: Record<string, number | undefined>) {
  return [
    {
      label: "5M",
      change: Number(m.priceChange5m ?? 0),
      volume: Number(m.volume5mUsd ?? 0),
      buys: Number(m.buys5m ?? 0),
      sells: Number(m.sells5m ?? 0),
    },
    {
      label: "1H",
      change: Number(m.priceChange1h ?? 0),
      volume: Number(m.volume1hUsd ?? 0),
      buys: Number(m.buys1h ?? 0),
      sells: Number(m.sells1h ?? 0),
    },
    {
      label: "1D",
      change: Number(m.priceChange24h ?? 0),
      volume: Number(m.volume24hUsd ?? 0),
      buys: Number(m.buys24h ?? 0),
      sells: Number(m.sells24h ?? 0),
    },
  ];
}

/*
  Candidate sweep — the bullseye selection rules, applied to the Quant catalog.

  Base metrics: market cap inside a small-cap band, real 24h volume, real
  liquidity, 6h and 24h change not deeply negative, and a market cap that hasn't
  run far ahead of its own liquidity.

  Then the rug / wash / sniper-bait gates: pair old enough to not be sniper bait
  and young enough to not be stale, some genuine 5-minute activity, sells not
  swamping buys, and volume not absurd against liquidity. Finally a Telegram
  community, because a call needs somewhere to send people.

  Matching tokens are shuffled and one is picked, exactly as bullseye does, so
  the channel doesn't march down the catalog in score order. Pacing is a random
  gap between posts rather than a fixed cadence.
*/
export async function sweepChannelCalls(): Promise<number> {
  const cfg = await getChannelConfig();
  if (!cfg.enabled || !cfg.chatId) return 0;

  /*
    Random interval, seeded from the last call. The gap for THIS decision is
    drawn once per attempt, so posts land unevenly like a human would.
  */
  const lo = Math.min(cfg.postIntervalMinMins, cfg.postIntervalMaxMins);
  const hi = Math.max(cfg.postIntervalMinMins, cfg.postIntervalMaxMins);
  const gapMins = lo + Math.random() * (hi - lo);
  const last = await prisma.channelCall.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && Date.now() < last.createdAt.getTime() + gapMins * 60_000) return 0;

  const RISK = ["HONEYPOT_RISK", "RUG_RISK", "HIGH_TAX"];
  const now = Date.now();

  // cheap DB-side cut first, on the columns we actually index
  const candidates = await prisma.token.findMany({
    where: {
      blacklisted: false,
      marketCapUsd: { gte: cfg.minMcapUsd, lte: cfg.maxMcapUsd },
      liquidityUsd: { gte: cfg.minLiquidityUsd },
      ...(cfg.minScore > 0 ? { currentScore: { gte: cfg.minScore } } : {}),
      pairCreatedAt: {
        gte: new Date(now - cfg.maxPairAgeDays * 86_400_000),
        lte: new Date(now - cfg.minPairAgeMins * 60_000),
      },
      NOT: { flags: { hasSome: RISK } },
    },
    take: 400,
    select: {
      chain: true,
      address: true,
      symbol: true,
      name: true,
      currentScore: true,
      liquidityUsd: true,
      marketCapUsd: true,
      dex: true,
      pairCreatedAt: true,
      market: true,
      updatedAt: true,
    },
  });
  if (candidates.length === 0) return 0;

  // never call the same coin twice
  const called = await prisma.channelCall.findMany({
    where: { tokenAddress: { in: candidates.map((c) => c.address) } },
    select: { chain: true, tokenAddress: true },
  });
  const seen = new Set(called.map((c) => `${c.chain}:${c.tokenAddress}`));

  const passing = candidates.filter((row) => {
    if (seen.has(`${row.chain}:${row.address}`)) return false;
    const m = (row.market ?? {}) as Record<string, number | undefined>;

    const price = Number(m.priceUsd ?? 0);
    if (price <= 0) return false;

    const mcap = row.marketCapUsd;
    const liq = row.liquidityUsd;
    const vol = Number(m.volume24hUsd ?? 0);

    // base metrics
    if (vol < cfg.minVolume24hUsd) return false;
    /*
      Only call what's moving up.

      The old test passed anything above -20%, so a token already down 19% on
      the day qualified as a call — which is how calls came to be posted on
      tokens that then fell 60-90%. A call is a claim that a token has room to
      run; something mid-decline plainly doesn't.

      The recent window has to be genuinely positive. The daily window only has
      to not be collapsing, so a token that dipped yesterday and is breaking out
      today still qualifies — that's the shape most runs actually have.
    */
    if (Number(m.priceChange6h ?? 0) < cfg.minPriceChangePct) return false;
    if (Number(m.priceChange24h ?? 0) < -25) return false;
    // liquidity has to be real but still smaller than the cap it supports
    if (!(liq > 0 && liq < mcap)) return false;
    if (mcap / liq > cfg.maxMcapLiqRatio) return false;

    /*
      Recent activity, and not a sell-off.

      The five-minute counters are only as fresh as the last ingest of that
      chain, and with several chains sharing the rotation a row is routinely
      twenty minutes old. Judging live activity on a stale snapshot marked
      almost everything dead — it was throwing out well over a third of every
      candidate set, which is why the channel went quiet. So the five-minute
      window is used while it's genuinely recent, and the hour is used when
      it isn't: same question, asked of data that can actually answer it.
    */
    const buys5m = Number(m.buys5m ?? 0);
    const sells5m = Number(m.sells5m ?? 0);
    const fresh5m = Date.now() - row.updatedAt.getTime() < 10 * 60_000;
    if (fresh5m) {
      if (buys5m + sells5m < cfg.minTxns5mTotal) return false;
      if (sells5m > Math.max(1, buys5m) * cfg.maxSellBuyRatio5m) return false;
    } else {
      const buys1h = Number(m.buys1h ?? 0);
      const sells1h = Number(m.sells1h ?? 0);
      if (buys1h + sells1h < cfg.minTxns5mTotal) return false;
      if (sells1h > Math.max(1, buys1h) * cfg.maxSellBuyRatio5m) return false;
    }

    // wash-trading smell
    if (vol > Math.max(1, liq) * cfg.maxVolLiqRatio24h) return false;

    return true;
  });
  if (passing.length === 0) return 0;

  /*
    Rank the candidates instead of shuffling them.

    Picking at random from everything that merely passed the filters meant the
    best token and the weakest had the same chance of being called. What's
    wanted is the one with the most room and the strongest bid behind it, so
    candidates are ordered by a composite of the safety score, recent buy
    pressure, momentum, and how early it still is — a token that has already
    run to a large cap has less left to give than one just turning.
  */
  const rank = (row: (typeof passing)[number]) => {
    const m = (row.market ?? {}) as Record<string, number | undefined>;
    const buys = Number(m.buys1h ?? 0);
    const sells = Number(m.sells1h ?? 0);
    const flow = buys + sells > 0 ? buys / (buys + sells) : 0.5;
    const chg6 = Number(m.priceChange6h ?? 0);
    const turnover = row.liquidityUsd > 0 ? Number(m.volume24hUsd ?? 0) / row.liquidityUsd : 0;

    // headroom: a smaller cap has further it can plausibly travel
    const headroom = row.marketCapUsd > 0 ? Math.max(0, 1 - Math.log10(row.marketCapUsd) / 7) : 0;

    return (
      (row.currentScore ?? 0) * 0.5 +      // safety first — a rug is not a call
      Math.min(flow, 1) * 25 +             // more buyers than sellers
      Math.min(chg6, 60) * 0.35 +          // already turning, not yet extended
      Math.min(turnover, 4) * 5 +          // real trading, not a dead pool
      headroom * 20
    );
  };
  passing.sort((a, b) => rank(b) - rank(a));

  /*
    A bounded number of link lookups per pass. Each is an external round-trip
    inside the ingest, so this can't be a long loop — but three was too few:
    most candidates have no Telegram, so a pass would usually check three,
    find none, and post nothing. The interval then meant nothing, because the
    limiter was the lookup budget rather than the schedule.
  */
  for (const row of passing.slice(0, 8)) {
    const chain = row.chain.toLowerCase() as ChainId;
    const m = (row.market ?? {}) as Record<string, number | undefined>;

    if (cfg.requireTelegram) {
      const links = await fetchTokenLinks(chain, row.address).catch(() => null);
      const hasTg = links?.socials?.some((l) => /telegram|t\.me/i.test(`${l.type} ${l.url}`));
      if (!hasTg) continue;
    }

    const card = await buildCallCard(
      {
        chain,
        address: row.address,
        symbol: row.symbol,
        name: row.name,
        score: row.currentScore,
        priceUsd: Number(m.priceUsd ?? 0),
        mcapUsd: row.marketCapUsd,
        liquidityUsd: row.liquidityUsd,
        dex: row.dex ?? "",
        pairCreatedAt: row.pairCreatedAt,
        creatorPct: m.creatorPct == null ? null : Number(m.creatorPct),
        rows: statRows(m),
      },
      cfg,
    );

    const messageId = await postToChannel(cfg.chatId, card.text, {
      keyboard: card.keyboard,
      preview: false,
    }).catch(() => null);

    await prisma.channelCall
      .create({
        data: {
          chain: row.chain,
          tokenAddress: row.address,
          symbol: row.symbol,
          chatId: cfg.chatId,
          messageId,
          callPriceUsd: Number(m.priceUsd ?? 0),
          callMcapUsd: row.marketCapUsd,
          callLiqUsd: row.liquidityUsd,
          score: row.currentScore,
          lastCheckAt: new Date(),
        },
      })
      .catch(() => {});

    return 1; // one call per pass; the random gap sets the real pace
  }

  return 0;
}

/*
  Gain milestones. For every live call, compare the live price to the price at
  call time and thread a reply for each newly cleared multiple. Losses are never
  posted; a call that dumps or loses its pool is retired and goes quiet.
*/
export async function checkCallMilestones(): Promise<number> {
  const cfg = await getChannelConfig();
  if (!cfg.enabled || !cfg.chatId) return 0;

  const milestones = [...cfg.milestones].sort((a, b) => a - b);
  if (milestones.length === 0) return 0;

  /*
    Every live call is tracked — no cap on how many updates go out. Retired
    calls are excluded by the query, and the batch is ordered by staleness so
    across passes every open call gets checked, however many there are.
  */
  const calls = await prisma.channelCall.findMany({
    where: { retiredAt: null },
    orderBy: [{ lastCheckAt: "asc" }, { createdAt: "asc" }],
    take: 60,
  });
  if (calls.length === 0) return 0;

  /*
    Load every token in ONE query. Looking them up per call cost one Neon
    round-trip each, which was enough to stall the whole ingest pass — and the
    ingest runs inside page traffic, so it stalled the site with it.
  */
  const tokenRows = await prisma.token.findMany({
    where: { address: { in: calls.map((c) => c.tokenAddress) } },
    select: {
      chain: true,
      address: true,
      market: true,
      marketCapUsd: true,
      liquidityUsd: true,
      symbol: true,
      flags: true,
      blacklisted: true,
    },
  });
  const tokenByKey = new Map(tokenRows.map((t) => [`${t.chain}:${t.address}`, t]));

  /*
    Price the calls directly rather than trusting the stored row.

    Discovery only refreshes tokens that happen to be on the popular pages, so
    a called token drops off them within hours and is never priced again. Its
    stored price stays frozen at whatever it was — which for a call means the
    multiple reads exactly 1.00x forever, no milestone can ever fire, and the
    retirement checks judge a dead token on week-old numbers. A tracker has to
    fetch its own prices; that's the whole job.
  */
  const freshPrice = new Map<string, number>();
  const byChain = new Map<string, string[]>();
  for (const c of calls) {
    const k = c.chain.toLowerCase();
    byChain.set(k, [...(byChain.get(k) ?? []), c.tokenAddress]);
  }
  await Promise.all(
    [...byChain.entries()].map(async ([chain, addrs]) => {
      const pools = await fetchPoolsForAddresses(chain as ChainId, addrs).catch(() => []);
      for (const pool of pools) {
        if (pool.priceUsd > 0) {
          freshPrice.set(`${chain.toUpperCase()}:${pool.tokenAddress}`, pool.priceUsd);
        }
      }
    }),
  );

  let sent = 0;
  for (const c of calls) {
    if (c.callPriceUsd <= 0) {
      await retire(c.id, "no call price");
      continue;
    }

    const token = tokenByKey.get(`${c.chain}:${c.tokenAddress}`);

    // gone entirely — delisted, blacklisted, or dropped from the catalog
    if (!token || token.blacklisted) {
      await retire(c.id, "token gone");
      continue;
    }

    // the live reading if we got one, else the stored row as a fallback
    const m = (token.market ?? {}) as Record<string, number | undefined>;
    const price = freshPrice.get(`${c.chain}:${c.tokenAddress}`) ?? Number(m.priceUsd ?? 0);
    if (price <= 0) {
      await retire(c.id, "no price");
      continue;
    }

    const multiple = price / c.callPriceUsd;
    const peak = Math.max(c.peakMultiple, multiple);

    /*
      Retire the dips and the dead before considering any update. A retired call
      is simply never mentioned again — the drop itself is never posted.
    */
    const dropPct = (1 - multiple) * 100;
    if (dropPct >= cfg.retireDropPct) {
      await retire(c.id, `dropped ${dropPct.toFixed(0)}%`, peak);
      continue;
    }
    if (c.callLiqUsd > 0 && token.liquidityUsd < (c.callLiqUsd * cfg.retireLiqPct) / 100) {
      await retire(c.id, "liquidity pulled", peak);
      continue;
    }
    if (token.flags.some((f) => f === "RUG_RISK" || f === "HONEYPOT_RISK")) {
      await retire(c.id, "risk flag", peak);
      continue;
    }

    /*
      Milestone memory: hitMultiples records every multiple already announced,
      so a call that jumps straight past 2x and 3x to 5x announces 5x once and
      never repeats any of them.
    */
    const due = milestones.filter((x) => multiple >= x && !c.hitMultiples.includes(x));
    const top = due.length > 0 ? due[due.length - 1] : null;

    if (top !== null) {
      const gain = (multiple - 1) * 100;
      const text = [
        `🚀 <b>$${esc(token.symbol)}</b> 已达 <b>${top}倍</b>`,
        "",
        `市值: <b>${usdc(token.marketCapUsd)}</b>`,
        `喊单时: ${usdc(c.callMcapUsd)}`,
        `自喊单: <b>+${gain.toFixed(0)}%</b>`,
      ].join("\n");

      await postToChannel(c.chatId, text, {
        replyTo: c.messageId ?? undefined,
        keyboard: [
          [
            {
              text: `💰 买入 ${token.symbol}`,
              url: `https://t.me/${BOT_HANDLE}?start=buy_${c.chain.toLowerCase()}_${c.tokenAddress}`,
            },
          ],
        ],
      }).catch(() => null);
      sent += 1;
    }

    await prisma.channelCall
      .update({
        where: { id: c.id },
        data: {
          peakMultiple: peak,
          lastCheckAt: new Date(),
          ...(due.length > 0 ? { hitMultiples: [...c.hitMultiples, ...due] } : {}),
        },
      })
      .catch(() => {});
  }

  return sent;
}

/* Stop tracking a call. Nothing is posted — the channel just goes quiet on it. */
async function retire(id: string, reason: string, peak?: number): Promise<void> {
  await prisma.channelCall
    .update({
      where: { id },
      data: {
        retiredAt: new Date(),
        retiredReason: reason.slice(0, 80),
        lastCheckAt: new Date(),
        ...(peak != null ? { peakMultiple: peak } : {}),
      },
    })
    .catch(() => {});
}

/*
  One-off channel announcement: Solana support.

  Deliberately shorter than a call card. A call has to justify itself with
  numbers; an announcement only has to say what changed and where to go, and
  padding it out is what makes a channel post read like marketing.
*/
export function buildSolanaAnnouncement(): { text: string; keyboard: Keyboard } {
  const site = getSiteUrl();
  const text = [
    `🟣 <b>Quant AI 现已支持 Solana</b>`,
    "",
    `Solana 新币已接入，与 ETH、BNB、Base 使用同一套十项评分：`,
    `铸币权限 · 冻结权限 · 流动性锁定 · 持币集中度`,
    "",
    `• 新池实时扫描`,
    `• 0–100 安全评分`,
    `• 一键买入`,
  ].join("\n");

  const keyboard: Keyboard = [
    [{ text: "立即交易 SOL", url: `${site}/screener?chain=SOL` }],
    [{ text: "查看评分", url: `${site}/screener` }],
  ];
  return { text, keyboard };
}
