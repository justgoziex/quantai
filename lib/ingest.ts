import { prisma, dbConfigured } from "./db";
import {
  fetchNewPools,
  fetchTrendingPools,
  fetchTopPools,
  type GtPool,
} from "./datasources/geckoterminal";
import { fetchDexScreenerPools, fetchPoolsForAddresses } from "./datasources/dexscreener";
import { blockscoutSupported, fetchExplorerHolders } from "./datasources/blockscout";
import { fetchTokenSecurity, fetchSolanaSecurity, type TokenSecurity } from "./datasources/goplus";
import { fetchSolanaSecurityFast, solanaFastSecurityAvailable } from "./datasources/solana-security";
import { fetchRugChecks, fetchSolanaRugChecks, rugcheckSupported, type RugCheck } from "./datasources/honeypot";
import {
  scoreToken,
  scoreProvisional,
  scoreMarketOnly,
  scoreRugChecked,
  decideSignalAny,
} from "./scoring";
import { CHAIN_LIST, CHAINS, normalizeAddress, type ChainId } from "./chains";
import { sanitizeText } from "./text-safety";
import type { Chain } from "./generated/prisma/enums";

/*
  Ingest engine — discovery + scoring pipeline.

  Performance model (Neon is ~5–20ms per round-trip, so round-trips are the
  budget, not CPU):
   · one findMany loads every existing token touched by the pass
   · scoring happens in memory
   · writes go out as createMany + chunked update transactions
  A pass that used to cost ~400 sequential round-trips now costs ~10–15.

  Concurrency: a DB-side lock (PlatformConfig "ingestLock") keeps multiple
  warm serverless instances from running overlapping passes; the in-process
  throttle just avoids needless lock reads.
*/
export type IngestSummary = Record<
  string,
  { seen: number; listed: number; skipped: number; signals: number }
>;

let lastRun = 0;

const LOCK_KEY = "ingestLock";
const LOCK_MS = 75_000;

async function acquireIngestLock(): Promise<boolean> {
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key: LOCK_KEY } });
    const at = row ? Number((row.value as { at?: number })?.at ?? 0) : 0;
    if (Date.now() - at < LOCK_MS) return false;
    await prisma.platformConfig.upsert({
      where: { key: LOCK_KEY },
      update: { value: { at: Date.now() } },
      create: { key: LOCK_KEY, value: { at: Date.now() } },
    });
    return true;
  } catch {
    return true; // if the lock table hiccups, prefer running over stalling
  }
}

type Scored = {
  pool: GtPool & { category?: "new" | "trending" };
  sec: TokenSecurity | undefined;
  hp: RugCheck | undefined;
  tier: "full" | "rug" | "market" | "none";
  result: { score: number; breakdown: Record<string, number>; flags: string[] };
  market: Record<string, unknown>;
  existing: ExistingToken | undefined;
};

type ExistingToken = {
  id: string;
  address: string;
  currentScore: number;
  flags: string[];
  holders: number;
  market: unknown;
  gateBreakdown: unknown;
  peakMarketCapUsd: number;
};

/*
  Batch-score and persist a set of pools for one chain.
  Respects the no-downgrade rule and fires signals per the documented rules.
*/

/*
  Rug check for a chain. Honeypot.is simulates a sell and is EVM-only; Solana
  is served by rugcheck.xyz, which reads the mint itself. Same shape either way.
*/
function rugChecksFor(chainId: ChainId, addrs: string[]) {
  return chainId === "sol" ? fetchSolanaRugChecks(addrs) : fetchRugChecks(chainId, addrs);
}

/*
  Security read for a chain. Solana has its own GoPlus endpoint and its own
  risk shape, so it branches here rather than inside the scoring engine.
*/
function securityFor(chainId: ChainId, addresses: string[]) {
  if (chainId !== "sol") return fetchTokenSecurity(chainId, addresses);
  /*
    Helius answers the same questions in a fraction of the time GoPlus takes,
    and GoPlus doesn't batch — that single-request-per-token limit is what left
    every Solana token stuck at the provisional cap. Fall back when the key
    isn't configured.
  */
  return solanaFastSecurityAvailable()
    ? fetchSolanaSecurityFast(addresses)
    : fetchSolanaSecurity(addresses);
}

/*
  The LP-lock share comes from the rug checker rather than the security read on
  Solana, so it's folded in before scoring — otherwise the lpLock gate scores
  zero for every token and caps the whole chain about 18 points low.
*/
function mergeLpLock(
  security: Map<string, TokenSecurity>,
  rugchecks: Map<string, RugCheck>,
): Map<string, TokenSecurity> {
  for (const [addr, sec] of security) {
    const lp = rugchecks.get(addr)?.lpLockedPct;
    if (lp != null && lp > sec.lpLockedPct) security.set(addr, { ...sec, lpLockedPct: lp });
  }
  return security;
}

export async function batchUpsertPools(
  chainId: ChainId,
  pools: (GtPool & { category?: "new" | "trending" })[],
  security: Map<string, TokenSecurity>,
  rugchecks: Map<string, RugCheck> = new Map(),
): Promise<{ listed: number; skipped: number; signals: number }> {
  const chainEnum = chainId.toUpperCase() as Chain;
  const securitySupported = CHAINS[chainId].securitySupported;
  const out = { listed: 0, skipped: 0, signals: 0 };
  if (pools.length === 0) return out;

  // 1) load everything we already know in ONE query
  const addresses = pools.map((p) => p.tokenAddress);
  const existingRows = await prisma.token.findMany({
    where: { chain: chainEnum, address: { in: addresses } },
    select: {
      id: true,
      address: true,
      currentScore: true,
      flags: true,
      holders: true,
      market: true,
      gateBreakdown: true,
      // needed so the peak can only ever move upward
      peakMarketCapUsd: true,
    },
  });
  const existingByAddr = new Map(existingRows.map((t) => [t.address, t]));

  // recent signals for cooldown checks — one query, grouped in memory
  const recentSignals = existingRows.length
    ? await prisma.signal.findMany({
        where: {
          tokenId: { in: existingRows.map((t) => t.id) },
          firedAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
        },
        select: { tokenId: true, type: true, firedAt: true },
      })
    : [];
  const signalsByToken = new Map<string, { type: string; firedAt: Date }[]>();
  for (const s of recentSignals) {
    const arr = signalsByToken.get(s.tokenId) ?? [];
    arr.push(s);
    signalsByToken.set(s.tokenId, arr);
  }

  // 2) score in memory — verification ladder:
  //    full (GoPlus) > rug-checked (sell simulation) > kept full score >
  //    provisional SCREENING / market-only
  const scored: Scored[] = [];
  for (const pool of pools) {
    const existing = existingByAddr.get(pool.tokenAddress);
    const sec = security.get(pool.tokenAddress);
    const hp = rugchecks.get(pool.tokenAddress);
    // "full" means the ten gates ran — SCREENING/RUGCHECKED are upgradeable
    const hadFullScore =
      existing &&
      !existing.flags.includes("SCREENING") &&
      !existing.flags.includes("RUGCHECKED");
    let tier: Scored["tier"];
    let result;
    if (sec) {
      tier = "full";
      result = scoreToken(sec, pool);
    } else if (hp && securitySupported && !hadFullScore) {
      tier = "rug";
      result = scoreRugChecked(hp, pool);
    } else if (hadFullScore) {
      tier = "none"; // keep the verified score; no fresh security this pass
      result = {
        score: existing!.currentScore,
        breakdown: (existing!.gateBreakdown ?? {}) as Record<string, number>,
        flags: existing!.flags,
        disqualified: false,
      };
    } else if (securitySupported) {
      tier = "none";
      result = scoreProvisional(pool); // SCREENING — enriched next pass
    } else {
      tier = "market"; // no security source exists on this chain
      result = scoreMarketOnly(pool);
    }
    if (result.disqualified) {
      out.skipped++;
      continue;
    }
    scored.push({ pool, sec, hp, tier, result, market: marketJson(pool, sec ?? null), existing });
  }

  // 3) creates in one round-trip
  const creates = scored.filter((s) => !s.existing);
  if (creates.length > 0) {
    await prisma.token.createMany({
      data: creates.map(({ pool, sec, result, market }) => {
        const [symbol, quote] = pool.name.split("/").map((x) => x.trim());
        return {
          chain: chainEnum,
          address: pool.tokenAddress,
          name: sanitizeText(symbol || pool.tokenAddress.slice(0, 8), 60) || pool.tokenAddress.slice(0, 8),
          symbol: sanitizeText(symbol || "?", 12) || "?",
          pairAddress: pool.poolAddress,
          dex: pool.dex || quote,
          liquidityUsd: saneLiquidity(pool),
          marketCapUsd: saneMarketCap(pool.fdvUsd, pool.liquidityUsd),
          peakMarketCapUsd: saneMarketCap(pool.fdvUsd, pool.liquidityUsd),
          holders: sec?.holderCount ?? 0,
          pairCreatedAt: new Date(pool.createdAt),
          currentScore: result.score,
          gateBreakdown: result.breakdown,
          flags: result.flags,
          market: market as never,
          category: pool.category ?? "lookup",
        };
      }),
      skipDuplicates: true,
    });
  }

  // 4) updates in chunked transactions (unique data per row, so per-row
  //    update statements — but batched 50 per round-trip)
  const updates = scored.filter((s) => s.existing);
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    await prisma.$transaction(
      chunk.map(({ pool, sec, result, market, existing }) =>
        prisma.token.update({
          where: { id: existing!.id },
          data: {
            liquidityUsd: saneLiquidity(pool),
            marketCapUsd: saneMarketCap(pool.fdvUsd, pool.liquidityUsd),
            /*
              The peak only ever rises. A token that ran to a large cap and
              came back down still shows what it achieved, which is what
              creator cashback is priced from — pricing off today's number
              would pay nothing for a launch that genuinely worked.
            */
            peakMarketCapUsd: Math.max(
              existing!.peakMarketCapUsd ?? 0,
              saneMarketCap(pool.fdvUsd, pool.liquidityUsd),
            ),
            // keep a real holder count — never clobber with a missing reading
            holders:
              sec?.holderCount && sec.holderCount > 0 ? sec.holderCount : existing!.holders,
            currentScore: result.score,
            gateBreakdown: result.breakdown,
            flags: result.flags,
            market: { ...((existing!.market as Record<string, unknown>) ?? {}), ...market } as never,
            pairAddress: pool.poolAddress,
            dex: pool.dex,
            ...(pool.category ? { category: pool.category } : {}),
          },
        }),
      ),
    );
  }
  out.listed = scored.length;

  // 5) signal decisions on every verified tier (full / rug-checked / market)
  // → one createMany. Brand-new signal-eligible tokens need ids resolved first.
  const eligible = (s: Scored) => s.tier === "full" || s.tier === "rug" || s.tier === "market";
  const createdEligible = creates.filter(eligible);
  const createdIds =
    createdEligible.length > 0
      ? new Map(
          (
            await prisma.token.findMany({
              where: { chain: chainEnum, address: { in: createdEligible.map((s) => s.pool.tokenAddress) } },
              select: { id: true, address: true },
            })
          ).map((t) => [t.address, t.id]),
        )
      : new Map<string, string>();

  const decisions: {
    tokenId: string;
    type: "ENTRY" | "EXIT" | "RISK";
    score: number;
    reasoning: string;
    gates: Record<string, number>;
  }[] = [];
  for (const s of scored) {
    if (!eligible(s)) continue;
    const { pool, sec, result, existing, tier } = s;
    const tokenId = existing?.id ?? createdIds.get(pool.tokenAddress);
    if (!tokenId) continue;
    const decision = decideSignalAny({
      tier: tier as "full" | "rug" | "market",
      sec,
      pool,
      result: { ...result, disqualified: false },
      previousScore: existing?.currentScore ?? null,
      recentSignalTypes: (signalsByToken.get(tokenId) ?? []).map((x) => ({
        type: x.type,
        hoursAgo: (Date.now() - new Date(x.firedAt).getTime()) / 3_600_000,
      })),
    });
    if (decision) {
      decisions.push({
        tokenId,
        type: decision.type,
        score: result.score,
        reasoning: decision.reasoning,
        gates: result.breakdown,
      });
    }
  }
  if (decisions.length > 0) {
    await prisma.signal.createMany({ data: decisions as never });
    out.signals = decisions.length;
    // fan the signals out to everyone watching those tokens (in-app + Telegram)
    await fanOutSignals(decisions).catch(() => {});
  }

  return out;
}

/*
  Signal fan-out — when a signal fires on a token, everyone who has it on
  their watchlist hears about it immediately (in-app + Telegram). Bounded:
  a pass fires a handful of signals at most.
*/
async function fanOutSignals(
  decisions: { tokenId: string; type: string; score: number; reasoning: string }[],
): Promise<void> {
  // token info for every signal, once
  const tokens = await prisma.token.findMany({
    where: { id: { in: decisions.map((d) => d.tokenId) }, blacklisted: false },
    select: { id: true, symbol: true, chain: true, address: true },
  });
  const tokenById = new Map(tokens.map((t) => [t.id, t]));

  // push high-conviction ENTRY signals to subscribed trading-bot users (one-tap buy)
  await import("@/bot/signals")
    .then((m) =>
      m.pushSignalsToBotUsers(
        decisions
          .map((d) => {
            const t = tokenById.get(d.tokenId);
            return t
              ? { chain: t.chain.toLowerCase() as never, address: t.address, symbol: t.symbol, score: d.score, type: d.type, reasoning: d.reasoning }
              : null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null),
      ),
    )
    .catch(() => {});

  // watchlist fan-out (in-app + linked Telegram)
  const watchers = await prisma.watchlist.findMany({
    where: { tokenId: { in: decisions.map((d) => d.tokenId) } },
    select: { userId: true, tokenId: true },
  });
  if (watchers.length === 0) return;
  const { notifyUsers } = await import("./notify");
  const byToken = new Map<string, string[]>();
  for (const w of watchers) {
    const arr = byToken.get(w.tokenId) ?? [];
    arr.push(w.userId);
    byToken.set(w.tokenId, arr);
  }
  for (const d of decisions) {
    const users = byToken.get(d.tokenId);
    const tok = tokenById.get(d.tokenId);
    if (!users || !tok) continue;
    await notifyUsers(
      users,
      "SIGNAL",
      `${d.type} · ${tok.symbol} @ ${d.score}`,
      `${d.reasoning.slice(0, 220)}\nhttps://www.quantniumai.com/token/${tok.chain.toLowerCase()}/${tok.address}`,
      { tokenId: d.tokenId, type: d.type, score: d.score },
    );
  }
}

/*
  Price alerts — one-shot triggers checked right after a chain's prices
  refresh. ABOVE fires when price ≥ target, BELOW when ≤. Deactivates on fire.
*/
async function checkPriceAlerts(chainId: ChainId): Promise<void> {
  const chainEnum = chainId.toUpperCase() as Chain;
  const alerts = await prisma.priceAlert.findMany({
    where: { active: true, token: { chain: chainEnum, blacklisted: false } },
    include: { token: { select: { symbol: true, chain: true, address: true, market: true } } },
    take: 500,
  });
  if (alerts.length === 0) return;
  const { notifyUser } = await import("./notify");
  for (const a of alerts) {
    const price = Number((a.token.market as { priceUsd?: number } | null)?.priceUsd ?? 0);
    if (!price) continue;
    const hit = a.direction === "ABOVE" ? price >= a.priceUsd : price <= a.priceUsd;
    if (!hit) continue;
    await prisma.priceAlert.update({
      where: { id: a.id },
      data: { active: false, triggeredAt: new Date() },
    });
    await notifyUser(
      a.userId,
      "SIGNAL",
      `${a.token.symbol} ${a.direction === "ABOVE" ? "↑ above" : "↓ below"} $${a.priceUsd}`,
      `Live price ${price >= 0.01 ? "$" + price.toPrecision(4) : "$" + price.toExponential(2)} crossed your alert.\nhttps://www.quantniumai.com/token/${a.token.chain.toLowerCase()}/${a.token.address}`,
      { alertId: a.id, priceUsd: price },
    );
  }
}

/*
  Single-token path (used by /api/refresh) — same rules, one token.
*/
export async function upsertScoredToken(
  chainId: ChainId,
  pool: GtPool,
  sec: TokenSecurity | undefined,
  category?: "new" | "trending",
): Promise<"listed" | "skipped" | "signal"> {
  const r = await batchUpsertPools(chainId, [{ ...pool, category }],
    sec ? new Map([[pool.tokenAddress, sec]]) : new Map());
  if (r.skipped > 0) return "skipped";
  if (r.signals > 0) return "signal";
  return "listed";
}

/*
  One ingest pass. GeckoTerminal free tier is ~30 req/min, so each pass covers
  ONE chain with the full request budget — always the STALEST chain (oldest
  newest-token update), so sparse traffic can't starve a chain the way a
  wall-clock rotation could (e.g. a daily cron always landing on the same
  minute). Chains without GoPlus coverage (Robinhood) spend the saved budget
  on deeper discovery instead.
*/
/* The chain whose newest token update is oldest — never-ingested chains win. */
async function pickStalestChain() {
  try {
    const latest = await prisma.token.groupBy({ by: ["chain"], _max: { updatedAt: true } });
    const freshByChain = new Map(latest.map((l) => [String(l.chain).toLowerCase(), l._max.updatedAt]));
    /*
      Stalest wins, but weighted: a chain's age counts for more when its
      ingestWeight is higher, so Solana comes round about twice as often as
      each EVM chain without ever starving one.
    */
    const now = Date.now();
    const staleness = (c: (typeof CHAIN_LIST)[number]) => {
      const seen = freshByChain.get(c.id)?.getTime() ?? 0;
      const age = seen === 0 ? Number.MAX_SAFE_INTEGER / 8 : now - seen;
      return age * (c.ingestWeight ?? 1);
    };
    return [...CHAIN_LIST].sort((a, b) => staleness(b) - staleness(a))[0];
  } catch {
    // fallback to wall-clock rotation if the freshness query hiccups
    return CHAIN_LIST[Math.floor(Date.now() / 60_000) % CHAIN_LIST.length];
  }
}

export async function runIngest(): Promise<{ summary: IngestSummary; skipped?: string }> {
  if (!dbConfigured) return { summary: {}, skipped: "no database" };
  if (Date.now() - lastRun < 60_000) return { summary: {}, skipped: "ran recently" };
  const { isKilled } = await import("./config");
  if (await isKilled("ingest")) return { summary: {}, skipped: "kill switch" };
  if (!(await acquireIngestLock())) return { summary: {}, skipped: "locked" };
  lastRun = Date.now();

  const chain = await pickStalestChain();

  const summary: IngestSummary = {};
  const stats = { seen: 0, listed: 0, skipped: 0, signals: 0 };
  summary[chain.id] = stats;
  try {
    // Chains without security enrichment get deeper GT discovery (the GoPlus
    // budget is unused there): Robinhood pulls up to ~28 pages of pools.
    /*
      GeckoTerminal's free tier is ~30 requests a minute and a pass is a minute,
      so the page budget is the real constraint.

      Solana mints far more pairs per hour than any EVM chain here, so it takes
      a deeper sweep — 25 pages against the 16 an EVM chain uses — while still
      leaving headroom under the ceiling. Chains with no security enrichment
      spend their unused GoPlus budget on depth instead.
    */
    const depth = !chain.securitySupported
      ? { newP: 10, trend: 8, top: 10 }
      : chain.id === "sol"
        ? { newP: 10, trend: 7, top: 8 }
        : { newP: 6, trend: 5, top: 5 };

    const [newPools, trendingPools, topPools, ds] = await Promise.all([
      fetchNewPools(chain.id, depth.newP).catch(() => []),
      fetchTrendingPools(chain.id, depth.trend).catch(() => []),
      fetchTopPools(chain.id, depth.top).catch(() => []),
      fetchDexScreenerPools(chain.id).catch(() => ({ pools: [], boosted: new Set<string>() })),
    ]);

    // Dedup across sources by token; "new" wins over "trending". "Trenching"
    // is a live age-window view in /api/tokens, not a stored tag.
    const byToken = new Map<string, GtPool & { category?: "new" | "trending" }>();
    for (const p of topPools) byToken.set(p.tokenAddress, { ...p, category: "trending" });
    for (const p of ds.pools) byToken.set(p.tokenAddress, { ...p, category: "trending" });
    for (const p of trendingPools) byToken.set(p.tokenAddress, { ...p, category: "trending" });
    for (const p of newPools) byToken.set(p.tokenAddress, { ...p, category: "new" });
    const pools = [...byToken.values()];
    stats.seen = pools.length;

    if (pools.length > 0) {
      // Rug-check the freshest pools with real liquidity IMMEDIATELY — the
      // sell simulation works minutes after deploy, so new coins get scored
      // (and can fire signals) in the same pass they're discovered.
      /*
        Solana's checker is far cheaper than the EVM sell simulation (~0.7s per
        mint, 4 at a time) and its fresh pairs start thinner, so it gets a lower
        liquidity floor and a bigger slice. Without this every new Solana token
        sits at the provisional cap of 30 until a GoPlus read comes round —
        which, at 24 per pass against thousands, is never.
      */
      const rugFloor = chain.id === "sol" ? 500 : 5_000;
      const rugTake = chain.id === "sol" ? 45 : 20;
      const rugchecks = rugcheckSupported(chain.id)
        ? await rugChecksFor(
            chain.id,
            newPools
              .filter((p) => p.liquidityUsd >= rugFloor)
              .slice(0, rugTake)
              .map((p) => p.tokenAddress),
          ).catch(() => new Map<string, RugCheck>())
        : new Map<string, RugCheck>();

      const r = await batchUpsertPools(chain.id, pools, new Map(), rugchecks);
      stats.listed = r.listed;
      stats.skipped = r.skipped;
      stats.signals += r.signals;

      // …then a bounded GoPlus budget upgrades the highest-liquidity
      // still-provisional tokens to the full ten-gate read.
      if (chain.securitySupported) {
        // Solana carries the biggest provisional backlog and the cheapest
        // reads, so it gets the larger share of the screening budget.
        /*
          Sized to what the provider will actually answer, not to how many
          rows we can name. A batch of 120 came back with barely a fifth of it
          read — the rest was refused and silently dropped, so a pass looked
          productive while leaving the deepest tokens on a provisional score
          indefinitely. Sixty, read patiently, comes back near-complete and
          fits the pass budget.
        */
        stats.signals += await screenBatch(chain.id, chain.id === "sol" ? 60 : 24);
      }

      // prices just refreshed for this chain — fire any crossed price alerts
      await checkPriceAlerts(chain.id).catch(() => {});
    }

  } catch (e) {
    summary[chain.id] = { seen: -1, listed: -1, skipped: -1, signals: -1 };
    console.error(`ingest ${chain.id} failed:`, (e as Error).message);
  }

  /*
    Bot work runs whatever happened above.

    These used to sit inside the chain's try block, so one upstream failing —
    a timeout, a bad gateway on a single chain's discovery — took the channel
    down with it. The channel then looked broken for a reason that had nothing
    to do with the channel. What they read from is the database, which is
    already populated, so a failed discovery pass is no reason to skip them.
  */
  // keep the rest of the catalogue current, not just what's trending today
  /*
    300 a pass, not 90. These are batched thirty-to-a-request, so this is ten
    HTTP calls — cheap next to what it fixes. The catalogue had accumulated
    thousands of dead rows and at 90 a pass it would have taken days to walk
    them, all the while showing week-old prices as though they were live.
  */
  await refreshStalePrices(chain.id, 300).catch(() => {});

  /*
    Holder counts for chains with no security provider — the explorer knows
    them even when the vendors don't.
  */
  if (blockscoutSupported(chain.id)) {
    await (async () => {
      const missing = await prisma.token.findMany({
        where: {
          chain: chain.id.toUpperCase() as Chain,
          blacklisted: false,
          /*
            Missing counts first, but also implausibly small ones. A token with
            real liquidity and "4 holders" is a vendor artefact, not a fact
            about the token, and it reads on the screen as a red flag that
            isn't there.
          */
          OR: [{ holders: { lte: 0 } }, { holders: { lt: 25 }, liquidityUsd: { gte: 50_000 } }],
          liquidityUsd: { gte: 5_000 },
        },
        orderBy: { liquidityUsd: "desc" },
        // the explorer is quick and answers five at a time, so this can be
        // wider than the vendor-backed paths without slowing the pass
        take: 120,
        select: { id: true, address: true },
      });
      if (missing.length === 0) return;
      const counts = await fetchExplorerHolders(chain.id, missing.map((t) => t.address));
      if (counts.size === 0) return;
      /*
        Written in small transactions. A single transaction holding a hundred
        updates exceeds the five-second limit over a network connection and
        rolls the whole thing back, so a wide batch writes nothing at all.
      */
      const writes = missing
        .filter((t) => (counts.get(t.address) ?? 0) > 0)
        .map((t) =>
          prisma.token.update({ where: { id: t.id }, data: { holders: counts.get(t.address)! } }),
        );
      for (let i = 0; i < writes.length; i += 20) {
        await prisma.$transaction(writes.slice(i, i + 20)).catch(() => {});
      }
    })().catch(() => {});
  }

  /*
    Top up missing Solana holder counts. Small and bounded — these tokens are
    already scored, so this only fills a display gap the queue can no longer
    reach on its own.
  */
  if (chain.id === "sol") {
    await (async () => {
      const stale = await prisma.token.findMany({
        where: { chain: "SOL", blacklisted: false, holders: { lte: 0 }, liquidityUsd: { gte: 8_000 } },
        orderBy: { liquidityUsd: "desc" },
        take: 40,
        select: { id: true, address: true },
      });
      if (stale.length === 0) return;
      const { backfillHolderCounts } = await import("./datasources/solana-security");
      const counts = await backfillHolderCounts(stale.map((t) => t.address));
      if (counts.size === 0) return;
      const writes = stale
        .filter((t) => (counts.get(t.address) ?? 0) > 0)
        .map((t) =>
          prisma.token.update({ where: { id: t.id }, data: { holders: counts.get(t.address)! } }),
        );
      for (let i = 0; i < writes.length; i += 20) {
        await prisma.$transaction(writes.slice(i, i + 20)).catch(() => {});
      }
    })().catch(() => {});
  }

  await import("@/bot/orders").then((m) => m.checkBotOrders()).catch(() => {});

  // gain milestones on open channel calls (2x, 3x, 5x…) — replies only
  await import("@/bot/channel").then((m) => m.checkCallMilestones()).catch(() => {});

  /*
    Channel calls. Candidate selection lives entirely in the sweep — one
    filter, one code path — so what reaches the channel is exactly what the
    bullseye rules allow.
  */
  await import("@/bot/channel").then((m) => m.sweepChannelCalls()).catch(() => {});

  // expire promoted (paid) listings whose window has passed
  await prisma.token
    .updateMany({
      where: { promoted: true, promotedUntil: { lt: new Date() } },
      data: { promoted: false },
    })
    .catch(() => {});

  return { summary };
}

/*
  Screen a bounded batch of still-provisional tokens (SCREENING or missing a
  holder count), highest-liquidity first. GoPlus fetches stay rate-limited by
  design; persistence is batched.
*/
/*
  The slice of a chain's provisional backlog worth checking next.

  Newest-first was the wrong instinct: a mint minutes old isn't in the risk
  checker's index yet, so it answers nothing and gets picked again on the next
  pass — the same handful of unanswerable tokens, forever, while everything
  else stays capped.

  Deepest-first instead. Those are both the tokens the checker can actually
  answer for and the ones users see at the top of a feed, and `updatedAt`
  breaks ties so the queue rotates instead of re-reading one set.
*/
async function backlogAddresses(chainEnum: Chain, take: number): Promise<string[]> {
  const rows = await prisma.token.findMany({
    where: {
      chain: chainEnum,
      blacklisted: false,
      flags: { has: "SCREENING" },
      liquidityUsd: { gte: 1_000 }, // below this the checker rarely knows it
    },
    orderBy: [{ liquidityUsd: "desc" }, { updatedAt: "asc" }],
    take,
    select: { address: true },
  });
  return rows.map((r) => r.address);
}

async function screenBatch(chainId: ChainId, limit: number): Promise<number> {
  const chainEnum = chainId.toUpperCase() as Chain;
  /*
    Screen what people actually look at.

    Ordering purely by liquidity meant the deepest tokens got re-checked
    forever while everything new stayed provisional — and the feeds are sorted
    by recency, so the rows on screen were exactly the ones never reached.
    Two buckets instead: the freshest pairs with real liquidity first (that's
    the New tab), then the deepest unscreened (that's Trending).
  */
  const half = Math.max(1, Math.floor(limit / 2));

  /*
    A screening floor, because attention is the scarce resource here.

    Anyone can mint on Solana for a few cents, and most do: of ~2,900 Solana
    tokens carried, only ~440 hold $10k of liquidity. The rest are dead on
    arrival — one holder, a couple of thousand in market cap, nothing to trade.
    Screening them consumed the entire per-pass budget and pushed the tokens
    people can actually buy to the back of a queue that never drained.

    So a token has to clear a floor to be worth a full read, and Solana's floor
    is higher than the EVM chains' because its noise level is. Nothing is lost:
    a token that grows into real liquidity is picked up on the next pass.
  */
  const screenFloor = chainId === "sol" ? 8_000 : 1_000;
  const unscreened = {
    chain: chainEnum,
    blacklisted: false,
    liquidityUsd: { gte: screenFloor },
    OR: [
      { flags: { has: "SCREENING" } },
      { flags: { has: "RUGCHECKED" } }, // rug-tier upgrades to the full read
      /*
        A missing holder count means "never read" only where the holder source
        is reliable. On Solana it frequently has no figure for a token that was
        read perfectly well, so this clause made every finished token look
        unfinished — and since the queue is ordered by liquidity, each pass
        re-read the same deep tokens instead of advancing. The backlog behind
        them never moved, which is why so much of the catalogue sat in
        screening no matter how many passes ran.
      */
      ...(chainId === "sol" ? [] : [{ holders: { lte: 0 } }]),
    ],
  };
  const [fresh, deep] = await Promise.all([
    prisma.token.findMany({
      where: unscreened,
      orderBy: { pairCreatedAt: "desc" },
      take: half,
      select: {
        address: true, pairAddress: true, dex: true, liquidityUsd: true,
        marketCapUsd: true, pairCreatedAt: true, market: true, symbol: true,
      },
    }),
    prisma.token.findMany({
      where: unscreened,
      orderBy: { liquidityUsd: "desc" },
      take: limit - half,
      select: {
        address: true, pairAddress: true, dex: true, liquidityUsd: true,
        marketCapUsd: true, pairCreatedAt: true, market: true, symbol: true,
      },
    }),
  ]);
  const byAddr = new Map([...fresh, ...deep].map((t) => [t.address, t]));
  const stale = [...byAddr.values()];
  if (stale.length === 0) return 0;

  /*
    The two checks cost wildly different amounts, so they get different budgets.

    GoPlus is one address per request and is the expensive full read — it stays
    narrow. rugcheck.xyz answers in well under a second, four at a time, so on
    Solana it runs over a much wider slice. That's what drains a provisional
    backlog: the cheap check lifts hundreds off the cap while the expensive one
    upgrades the front of the queue to the full ten gates.
  */
  const addrs = stale.map((t) => t.address);
  /*
    The wide set must CONTAIN the narrow one. The two checks answer different
    halves of the same token: the security read gives mint and freeze
    authority, the rug check gives LP lock. A token that gets one without the
    other is scored as though the missing half were absent — and an absent LP
    lock reads as "fully unlocked", which caps the score at 55 no matter how
    sound the token is. That cap, not the scoring, is why nothing on Solana
    ever climbed past the middle of the range.
  */
  const wideAddrs =
    chainId === "sol"
      ? [...new Set([...addrs, ...(await backlogAddresses(chainEnum, 90))])]
      : addrs;

  const [security, rugchecks] = await Promise.all([
    securityFor(chainId, addrs).catch(() => new Map<string, TokenSecurity>()),
    rugChecksFor(chainId, wideAddrs).catch(() => new Map<string, RugCheck>()),
  ]);
  if (security.size === 0 && rugchecks.size === 0) return 0;
  mergeLpLock(security, rugchecks);

  // anything the wide check reached also needs a row to write against
  const extra =
    wideAddrs === addrs
      ? []
      : await prisma.token.findMany({
          where: { chain: chainEnum, address: { in: [...rugchecks.keys()] } },
          select: {
            address: true, pairAddress: true, dex: true, liquidityUsd: true,
            marketCapUsd: true, pairCreatedAt: true, market: true, symbol: true,
          },
        });
  const allRows = new Map([...stale, ...extra].map((t) => [t.address, t]));

  const pools = [...allRows.values()]
    .filter((t) => security.has(t.address) || rugchecks.has(t.address))
    .map((t) => reconstructPool(t, chainId));
  const r = await batchUpsertPools(chainId, pools, security, rugchecks);
  return r.signals;
}

/*
  Re-price the tokens discovery never comes back to.

  Discovery walks the popular pages, which is a few hundred tokens per chain.
  Everything else in the catalogue is written once and then frozen — measured
  on production, the median Ethereum token had not been touched in fourteen
  days, so its price, market cap and liquidity on the site were two weeks old.
  Anything reading those numbers — a portfolio value, a price alert, a call
  being tracked — was working from fiction.

  This walks the rest of the catalogue oldest-first, so every token gets re-read
  on a rolling basis rather than only the ones that happen to be trending. It
  updates market data only: scoring needs a security read, and that has its own
  budget and its own queue.
*/
async function refreshStalePrices(chainId: ChainId, limit: number): Promise<number> {
  const chainEnum = chainId.toUpperCase() as Chain;
  const stale = await prisma.token.findMany({
    where: {
      chain: chainEnum,
      blacklisted: false,
      // worth the request: below this nobody is pricing a position off it
      liquidityUsd: { gte: 5_000 },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, address: true, pairAddress: true, liquidityUsd: true },
  });
  if (stale.length === 0) return 0;

  const pools = await fetchPoolsForAddresses(chainId, stale.map((t) => t.address)).catch(() => []);
  if (pools.length === 0) return 0;

  const byAddress = new Map(stale.map((t) => [t.address, t]));

  /*
    Refuse a reading that describes a different, shallower market.

    Sources don't cover the same venues. DAI's real depth sits in a Curve pool
    one source indexes and the other doesn't, so refreshing from the second
    would have rewritten $159m of liquidity down to $1.4m and repointed the
    chart at a pool almost nobody trades — the site under-reporting a token by
    two orders of magnitude, from a refresh meant to make it more accurate.

    So a quote is taken when it describes the pool already stored (a genuine
    change, including liquidity draining, which must be recorded) or when it
    has found a deeper one. A shallower pool elsewhere is a different market,
    not news about this one.
  */
  const priced = pools.filter((pool: GtPool) => {
    if (!(pool.priceUsd > 0)) return false;
    const row = byAddress.get(pool.tokenAddress);
    if (!row) return false;
    const samePool =
      Boolean(pool.poolAddress) && pool.poolAddress === (row.pairAddress ?? "");
    return samePool || pool.liquidityUsd >= row.liquidityUsd;
  });
  const updates = priced.map((pool: GtPool) =>
    prisma.token.update({
      where: { id: byAddress.get(pool.tokenAddress)!.id },
      data: {
        liquidityUsd: saneLiquidity(pool),
        marketCapUsd: saneMarketCap(pool.fdvUsd, pool.liquidityUsd),
        market: marketJson(pool, null) as never,
        /*
          Keep the pool in step with the numbers taken from it.

          Prices and liquidity were being refreshed from whichever pool is
          deepest today, while the stored pair stayed whatever it was on the
          day the token was first seen. The chart then drew one pool and every
          figure beside it described another — DAI showed a pair holding 1% of
          the liquidity its own row reported. A chart that doesn't match the
          numbers next to it is worse than no chart.
        */
        ...(pool.poolAddress ? { pairAddress: pool.poolAddress } : {}),
      },
    }),
  );

  for (let i = 0; i < updates.length; i += 20) {
    await prisma.$transaction(updates.slice(i, i + 20)).catch(() => {});
  }

  /*
    Deliberately NOT retiring tokens that the batch didn't return.

    An earlier version zeroed the liquidity of anything missing from the
    response, on the reasoning that a token with no pair has no liquidity.
    That reasoning was fine; the evidence was not. These lookups are batched,
    and a batch routinely comes back partial — so "absent from this response"
    was being read as "gone from the market", and live tokens scoring in the
    eighties were dropped out of the feed.

    Absence is not evidence. A token is only re-priced here when the upstream
    actually returns it; anything else is left exactly as it was, and the
    screening queue decides what deserves attention.
  */

  return updates.length;
}

/*
  A believable market cap, or nothing.

  Market cap is supply × price, and a token can mint whatever supply it likes.
  The catalogue was carrying 445 tokens claiming over a billion dollars, the
  worst of them at 1.4e60 — numbers produced by absurd supply against a
  fraction-of-a-cent price, on pools holding no liquidity at all.

  On a screen people trade from, a wrong number is worse than a blank: it sorts
  to the top and it anchors a decision. So an implausible reading is stored as
  zero, which the UI already renders as "—".

  Both tests stay well clear of real tokens. For comparison, PEPE's cap is 55x
  its liquidity and the deepest Solana token here is 11x; a hundred thousand
  times is not a market anyone can transact in. Tether, whose cap genuinely is
  enormous, sits at 73,000x and passes.
*/
/*
  Liquidity that nobody is trading against isn't liquidity.

  The catalogue carried entries claiming billions in a pool while doing a
  single dollar of daily volume across two transactions — ZEC at $5.1bn of
  "liquidity" and $1 traded, held by four addresses. Those reserves don't
  exist; the numbers are fabricated, and because the feed ranks by liquidity
  they sorted straight to the top of the board.

  A real pool of that size moves millions a day. So depth is only believed when
  something is actually trading against it. The test only applies above a
  million dollars — a genuinely quiet small pool is normal and stays.
*/
const FAKE_LIQ_FLOOR = 1_000_000;
const MIN_TURNOVER = 0.0005; // 0.05% of the pool changing hands in a day
const MIN_TXNS_24H = 20;

const LARGE_POOL = 10_000_000;

function saneLiquidity(pool: GtPool): number {
  const liq = Number(pool.liquidityUsd);
  if (!Number.isFinite(liq) || liq <= 0) return 0;
  if (liq < FAKE_LIQ_FLOOR) return liq;

  const txns = Number(pool.buys24h ?? 0) + Number(pool.sells24h ?? 0);
  const traded = Number(pool.volume24hUsd ?? 0);
  const quiet = traded < liq * MIN_TURNOVER;

  /*
    Past ten million, turnover alone settles it. A pool that size doing a few
    hundred dollars a day is fabricated however many transactions it reports —
    requiring a low transaction count as well let a claimed $3.3bn pool with
    $213 of daily volume stay at the top of the board.
  */
  if (liq >= LARGE_POOL && quiet) return 0;
  if (quiet && txns < MIN_TXNS_24H) return 0;
  return liq;
}

const MAX_PLAUSIBLE_MCAP = 1e12;
const MAX_MCAP_TO_LIQ = 1e5;

function saneMarketCap(fdvUsd: number, liquidityUsd: number): number {
  if (!Number.isFinite(fdvUsd) || fdvUsd <= 0) return 0;
  if (fdvUsd > MAX_PLAUSIBLE_MCAP) return 0;
  /*
    No pool, no market cap. A cap is supply times a market price, and with
    nothing to trade against there is no price to multiply by — quoting one
    puts a confident number on something that can't be bought or sold.
  */
  if (!(liquidityUsd > 0)) return 0;
  if (fdvUsd / liquidityUsd > MAX_MCAP_TO_LIQ) return 0;
  return fdvUsd;
}

/* Rebuild a GtPool from a stored token row (market data we already have). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reconstructPool(t: any, chainId: ChainId): GtPool {
  const m = (t.market ?? {}) as Record<string, number | undefined>;
  return {
    /*
      Normalise per chain, never blanket-lowercase. Solana addresses are base58
      and case-carrying: lowercasing one produces a string that matches nothing.
      That is what stalled Solana screening — the rebuilt pool no longer matched
      its own security reading, so every token fell back to the provisional
      score and stayed capped no matter how many times it was rescreened.
    */
    poolAddress: normalizeAddress(chainId, String(t.pairAddress ?? "")),
    tokenAddress: normalizeAddress(chainId, String(t.address)),
    name: `${t.symbol ?? "?"} / `,
    dex: t.dex ?? "",
    priceUsd: Number(m.priceUsd ?? 0),
    liquidityUsd: Number(t.liquidityUsd ?? 0),
    volume24hUsd: Number(m.volume24hUsd ?? 0),
    fdvUsd: Number(t.marketCapUsd ?? 0),
    buys1h: Number(m.buys1h ?? 0),
    sells1h: Number(m.sells1h ?? 0),
    buys24h: Number(m.buys24h ?? 0),
    sells24h: Number(m.sells24h ?? 0),
    priceChange1h: Number(m.priceChange1h ?? 0),
    priceChange6h: Number(m.priceChange6h ?? 0),
    priceChange24h: Number(m.priceChange24h ?? 0),
    volume1hUsd: Number(m.volume1hUsd ?? 0),
    buys5m: Number(m.buys5m ?? 0),
    sells5m: Number(m.sells5m ?? 0),
    priceChange5m: Number(m.priceChange5m ?? 0),
    volume5mUsd: Number(m.volume5mUsd ?? 0),
    createdAt: (t.pairCreatedAt ?? new Date()).toISOString(),
  };
}

/*
  Background loop — long-lived hosts only. On Vercel, a cron + traffic-driven
  waitUntil kicks runIngest instead.
*/
const g = globalThis as unknown as { __quantaiIngestLoop?: boolean };
if (
  !g.__quantaiIngestLoop &&
  dbConfigured &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  !process.env.VERCEL
) {
  g.__quantaiIngestLoop = true;
  const tick = () =>
    runIngest()
      .then((r) => {
        if (!r.skipped) console.log("[ingest]", JSON.stringify(r.summary));
      })
      .catch((e) => console.error("[ingest] failed:", (e as Error).message));
  setTimeout(tick, 3_000);
  setInterval(tick, 60_000);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function marketJson(pool: GtPool, sec: any) {
  return {
    priceUsd: pool.priceUsd,
    buys1h: pool.buys1h,
    sells1h: pool.sells1h,
    buys24h: pool.buys24h,
    sells24h: pool.sells24h,
    priceChange1h: pool.priceChange1h,
    priceChange6h: pool.priceChange6h,
    priceChange24h: pool.priceChange24h,
    volume1hUsd: pool.volume1hUsd,
    volume24hUsd: pool.volume24hUsd,
    buys5m: pool.buys5m,
    sells5m: pool.sells5m,
    priceChange5m: pool.priceChange5m,
    volume5mUsd: pool.volume5mUsd,
    ...(sec
      ? {
          topHolders: sec.topHolders,
          lpLockedPct: sec.lpLockedPct,
          creatorPct: sec.creatorPct,
          buyTaxPct: sec.buyTaxPct,
          sellTaxPct: sec.sellTaxPct,
        }
      : {}),
    source: "geckoterminal+goplus",
    at: new Date().toISOString(),
  };
}
