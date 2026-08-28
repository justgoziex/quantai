/*
  The market scoring engine — implements /scoring exactly.
  Weights (sum 100): honeypot 15 (hard gate), LP lock 18, holders 12,
  tax 8, depth 8, mint 10, verification 6, deployer 5, momentum 8, trend 10.
  Structural caps: open mint ⇒ score ≤ 40 · fully unlocked LP ⇒ score ≤ 55 ·
  detected sell-trap ⇒ score ≤ 45.
  Deterministic: same inputs, same score.
*/
import type { TokenSecurity } from "./datasources/goplus";
import type { RugCheck } from "./datasources/honeypot";
import type { GtPool } from "./datasources/geckoterminal";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/*
  Multi-window price-trend quality (0–10). Rewards sustained, orderly action
  and punishes dumps and blow-off tops — the shape of the move, not just the
  last hour. Shared by the full and provisional scorers; sets DUMPING/BLOWOFF
  flags via the passed array.
*/
function trendScore(pool: GtPool, flags?: string[]): number {
  const c1 = pool.priceChange1h;
  const c6 = pool.priceChange6h;
  const c24 = pool.priceChange24h;
  let t = 5; // neutral baseline
  if (c1 > 0 && c6 > 0) t += 2; // steady up
  if (c24 > 0) t += 1;
  if (c1 > 0 && c6 > 0 && c24 > 0) t += 1; // aligned across all windows
  if (c1 < -15) t -= 3; // sharp near-term drop
  if (c6 < -30) t -= 2; // bleeding out
  if (c24 > 400) t -= 2; // parabolic — high round-trip risk
  if (flags) {
    if (c1 < -20 || c6 < -40) flags.push("DUMPING");
    else if (c24 > 400) flags.push("BLOWOFF");
  }
  return clamp(t, 0, 10);
}

export type ScoreResult = {
  score: number;
  breakdown: Record<string, number>;
  flags: string[];
  disqualified: boolean; // hard gate failed — do not list
};

export function scoreToken(sec: TokenSecurity, pool: GtPool): ScoreResult {
  const breakdown: Record<string, number> = {};
  const flags: string[] = [];

  // 1. Honeypot — hard gate (15)
  if (sec.isHoneypot || sec.cannotSellAll || sec.sellTaxPct > 25) {
    return {
      score: 0,
      breakdown: { honeypot: 0 },
      flags: ["HONEYPOT_RISK"],
      disqualified: true,
    };
  }
  breakdown.honeypot = 15;

  // 2. LP lock (18) — share of LP locked or burned
  const lp = sec.lpLockedPct;
  breakdown.lpLock = lp >= 95 ? 18 : lp >= 80 ? 14 : lp >= 50 ? 9 : lp >= 20 ? 4 : 0;
  if (lp >= 80) flags.push("LP_LOCKED");

  // 3. Holder concentration (12)
  const top10 = sec.top10SharePct;
  breakdown.holders = top10 <= 15 ? 12 : top10 <= 25 ? 9 : top10 <= 35 ? 5 : top10 <= 50 ? 2 : 0;
  if (top10 > 25) flags.push(`TOP10_${Math.round(top10)}PCT`);

  // 4. Buy/sell tax (8) — with sell-trap detection (exit tax >> entry tax)
  const worstTax = Math.max(sec.buyTaxPct, sec.sellTaxPct);
  let taxPts = worstTax === 0 ? 8 : worstTax <= 3 ? 6 : worstTax <= 5 ? 4 : worstTax <= 10 ? 2 : 0;
  const sellTrap = sec.sellTaxPct > sec.buyTaxPct * 2 + 3 && sec.sellTaxPct > 8;
  if (sellTrap) {
    taxPts = Math.min(taxPts, 1);
    flags.push("SELL_TRAP");
  }
  breakdown.tax = taxPts;
  if (worstTax > 5 && !sellTrap) flags.push(`TAX_${Math.round(worstTax)}PCT`);

  // 5. Liquidity depth (8) — absolute liquidity and liq/FDV sanity
  const liq = pool.liquidityUsd;
  const ratio = pool.fdvUsd > 0 ? liq / pool.fdvUsd : 0;
  const liqPts = liq >= 250_000 ? 5 : liq >= 100_000 ? 4 : liq >= 50_000 ? 3 : liq >= 20_000 ? 2 : 0;
  const ratioPts = ratio >= 0.08 ? 3 : ratio >= 0.03 ? 2 : ratio > 0 ? 1 : 0;
  breakdown.depth = liqPts + ratioPts;

  // 6. Mint authority (10)
  breakdown.mint = sec.mintable ? 0 : 10;
  if (sec.mintable) flags.push("MINT_OPEN");

  // 7. Verification (6)
  breakdown.verification = sec.openSource ? 6 : 0;
  if (sec.openSource) flags.push("VERIFIED");
  if (sec.renounced) flags.push("RENOUNCED");

  // 8. Deployer / ownership (5) — renounced ownership earns the benefit of
  //    the doubt; retained ownership is a neutral-low midpoint.
  breakdown.deployer = sec.renounced ? 5 : 3;

  // 9. Momentum (8) — buy pressure + volume relative to liquidity
  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0.5;
  const turnover = liq > 0 ? pool.volume24hUsd / liq : 0;
  const pressurePts = buyRatio >= 0.6 ? 4 : buyRatio >= 0.5 ? 3 : buyRatio >= 0.4 ? 1 : 0;
  const turnoverPts = turnover >= 2 ? 4 : turnover >= 0.5 ? 3 : turnover >= 0.1 ? 2 : 0;
  breakdown.momentum = pressurePts + turnoverPts;

  // 10. Trend (10) — multi-window price-action quality (shape of the move)
  breakdown.trend = trendScore(pool, flags);

  let score = Object.values(breakdown).reduce((s, v) => s + v, 0);

  // structural caps
  if (sec.mintable) score = Math.min(score, 40);
  if (lp < 20) score = Math.min(score, 55);
  if (sellTrap) score = Math.min(score, 45);

  return { score: Math.round(score), breakdown, flags, disqualified: false };
}

/*
  Provisional scoring — security data (GoPlus) lags brand-new contracts by
  minutes. Fresh pairs list immediately in a SCREENING state: market gates
  only, hard-capped at 30 so nothing unscreened ever reads as tradeable.
  The next ingest pass replaces this with the full ten-gate reading.
*/
export function scoreProvisional(pool: GtPool): ScoreResult {
  const breakdown: Record<string, number> = {};
  const liq = pool.liquidityUsd;
  const ratio = pool.fdvUsd > 0 ? liq / pool.fdvUsd : 0;
  breakdown.depth =
    (liq >= 250_000 ? 6 : liq >= 100_000 ? 5 : liq >= 50_000 ? 4 : liq >= 20_000 ? 2 : 0) +
    (ratio >= 0.08 ? 3 : ratio >= 0.03 ? 2 : ratio > 0 ? 1 : 0);

  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0.5;
  const turnover = liq > 0 ? pool.volume24hUsd / liq : 0;
  breakdown.momentum =
    (buyRatio >= 0.6 ? 4 : buyRatio >= 0.5 ? 3 : buyRatio >= 0.4 ? 1 : 0) +
    (turnover >= 2 ? 4 : turnover >= 0.5 ? 3 : turnover >= 0.1 ? 2 : 0);
  breakdown.trend = trendScore(pool);

  const flags = ["SCREENING"];
  if (pool.priceChange1h < -20 || pool.priceChange6h < -40) flags.push("DUMPING");

  const score = Math.min(
    Object.values(breakdown).reduce((s, v) => s + v, 0),
    30,
  );
  return { score, breakdown, flags, disqualified: false };
}

/*
  Rug-checked scoring — a sell was SIMULATED against the live contract
  (Honeypot.is), so the honeypot + tax gates are real even though registry
  data (LP lock, mint, holders) hasn't landed yet. This runs on brand-new
  tokens minutes after deploy. Capped at 65 until the full ten-gate read.
*/
export function scoreRugChecked(hp: RugCheck, pool: GtPool): ScoreResult {
  // simulated honeypot / un-sellable → disqualify outright
  if (hp.simulated && (hp.isHoneypot || hp.sellTaxPct > 25)) {
    return { score: 0, breakdown: { honeypot: 0 }, flags: ["RUG_RISK"], disqualified: true };
  }

  const breakdown: Record<string, number> = {};
  const flags: string[] = ["RUGCHECKED"];

  // honeypot gate — earned by simulation, not registry
  breakdown.honeypot = hp.simulated ? 15 : 8;
  if (!hp.simulated) flags.push("SIM_PENDING");

  // tax gate from the simulation
  const worstTax = Math.max(hp.buyTaxPct, hp.sellTaxPct);
  breakdown.tax = worstTax === 0 ? 8 : worstTax <= 3 ? 6 : worstTax <= 5 ? 4 : worstTax <= 10 ? 2 : 0;
  const sellTrap = hp.sellTaxPct > hp.buyTaxPct * 2 + 3 && hp.sellTaxPct > 8;
  if (sellTrap) {
    breakdown.tax = Math.min(breakdown.tax, 1);
    flags.push("SELL_TRAP");
  }
  if (worstTax > 5 && !sellTrap) flags.push(`TAX_${Math.round(worstTax)}PCT`);

  // market gates (same shapes as the full scorer)
  const liq = pool.liquidityUsd;
  const ratio = pool.fdvUsd > 0 ? liq / pool.fdvUsd : 0;
  breakdown.depth =
    (liq >= 250_000 ? 5 : liq >= 100_000 ? 4 : liq >= 50_000 ? 3 : liq >= 20_000 ? 2 : 0) +
    (ratio >= 0.08 ? 3 : ratio >= 0.03 ? 2 : ratio > 0 ? 1 : 0);

  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0.5;
  const turnover = liq > 0 ? pool.volume24hUsd / liq : 0;
  breakdown.momentum =
    (buyRatio >= 0.6 ? 4 : buyRatio >= 0.5 ? 3 : buyRatio >= 0.4 ? 1 : 0) +
    (turnover >= 2 ? 4 : turnover >= 0.5 ? 3 : turnover >= 0.1 ? 2 : 0);
  breakdown.trend = trendScore(pool, flags);

  let score = Object.values(breakdown).reduce((s, v) => s + v, 0);
  if (sellTrap) score = Math.min(score, 40);
  return { score: Math.min(65, Math.round(score)), breakdown, flags, disqualified: false };
}

/*
  Market-only scoring — for chains without security coverage (e.g. Robinhood),
  where honeypot/LP/mint/tax gates can't be verified. Scores the market gates
  (depth, momentum, trend), scales them into a usable range, and flags
  UNVERIFIED so users know structure wasn't checked. Capped at 55 — no
  unverified token should read as "strong".
*/
export function scoreMarketOnly(pool: GtPool): ScoreResult {
  const breakdown: Record<string, number> = {};
  const liq = pool.liquidityUsd;
  const ratio = pool.fdvUsd > 0 ? liq / pool.fdvUsd : 0;
  breakdown.depth =
    (liq >= 250_000 ? 5 : liq >= 100_000 ? 4 : liq >= 50_000 ? 3 : liq >= 20_000 ? 2 : 0) +
    (ratio >= 0.08 ? 3 : ratio >= 0.03 ? 2 : ratio > 0 ? 1 : 0);

  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0.5;
  const turnover = liq > 0 ? pool.volume24hUsd / liq : 0;
  breakdown.momentum =
    (buyRatio >= 0.6 ? 4 : buyRatio >= 0.5 ? 3 : buyRatio >= 0.4 ? 1 : 0) +
    (turnover >= 2 ? 4 : turnover >= 0.5 ? 3 : turnover >= 0.1 ? 2 : 0);

  const flags = ["UNVERIFIED"];
  breakdown.trend = trendScore(pool, flags);

  // market gates max ~26 → scale ×2, cap 55
  const raw = Object.values(breakdown).reduce((s, v) => s + v, 0) * 2;
  return { score: Math.min(55, Math.round(raw)), breakdown, flags, disqualified: false };
}

/*
  Signal rules — discrete events on top of the continuous score.
  ENTRY: score ≥ 70, clear buy pressure, no ENTRY on this token in 6h.
  EXIT:  score fell ≥ 25 points from the previous reading, or dropped
         from ≥ 70 to < 55. No EXIT in 6h.
  RISK:  structural red flag while score < 40 (open mint / tax > 10%).
         No RISK in 24h.
*/
export type SignalDecision = {
  type: "ENTRY" | "EXIT" | "RISK";
  reasoning: string;
} | null;

export function decideSignal(opts: {
  sec: TokenSecurity;
  pool: GtPool;
  result: ScoreResult;
  previousScore: number | null;
  recentSignalTypes: { type: string; hoursAgo: number }[];
}): SignalDecision {
  const { sec, pool, result, previousScore, recentSignalTypes } = opts;
  const recent = (type: string, withinH: number) =>
    recentSignalTypes.some((s) => s.type === type && s.hoursAgo < withinH);

  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0;

  if (
    result.score >= 70 &&
    buyRatio >= 0.55 &&
    txns >= 10 &&
    !recent("ENTRY", 6)
  ) {
    return {
      type: "ENTRY",
      reasoning:
        `Score reached ${result.score} with ${Math.round(buyRatio * 100)}% of the last hour's ` +
        `${txns} trades buying. Liquidity ${usd(pool.liquidityUsd)} with ${Math.round(sec.lpLockedPct)}% of LP locked, ` +
        `top-10 holders at ${sec.top10SharePct.toFixed(1)}%, ${sec.openSource ? "verified contract" : "unverified contract"}` +
        `${sec.mintable ? "" : ", mint closed"}.`,
    };
  }

  if (
    previousScore !== null &&
    (previousScore - result.score >= 25 || (previousScore >= 70 && result.score < 55)) &&
    !recent("EXIT", 6)
  ) {
    return {
      type: "EXIT",
      reasoning:
        `Score dropped from ${previousScore} to ${result.score}. ` +
        `Buy share is ${Math.round(buyRatio * 100)}% over the last hour and 24h price change is ` +
        `${pool.priceChange24h.toFixed(1)}%. Structure is weakening — re-read the gates before holding on.`,
    };
  }

  const sellTrap = result.flags.includes("SELL_TRAP");
  const dumping = result.flags.includes("DUMPING");
  if (
    (result.score < 40 &&
      (sec.mintable || Math.max(sec.buyTaxPct, sec.sellTaxPct) > 10)) ||
    sellTrap ||
    (dumping && result.score < 50)
  ) {
    if (!recent("RISK", 24)) {
      const causes = [
        sec.mintable ? "mint authority is open" : null,
        sellTrap
          ? `sell tax (${Math.round(sec.sellTaxPct)}%) far exceeds buy tax — exit trap`
          : Math.max(sec.buyTaxPct, sec.sellTaxPct) > 10
            ? `effective tax runs ${Math.round(Math.max(sec.buyTaxPct, sec.sellTaxPct))}%`
            : null,
        dumping ? `price is dumping (${pool.priceChange1h.toFixed(1)}% 1h)` : null,
      ].filter(Boolean);
      return {
        type: "RISK",
        reasoning: `Scored ${result.score}: ${causes.join("; ")}. Supply, exit paths, or price action are working against holders.`,
      };
    }
  }

  return null;
}

/*
  Universal signal engine — fires on EVERY verification tier, with thresholds
  tightened as verification weakens (less certainty ⇒ demand more momentum):
   · "full" — ten gates verified (GoPlus): the documented rules.
   · "rug"  — sell simulation passed (Honeypot.is) but registry data pending:
              works on brand-new coins; slightly higher momentum bar.
   · "market" — no security source exists (Robinhood): market-only reads with
              the strictest bar, and the reasoning says so.
*/
export function decideSignalAny(opts: {
  tier: "full" | "rug" | "market";
  sec?: TokenSecurity | null;
  pool: GtPool;
  result: ScoreResult;
  previousScore: number | null;
  recentSignalTypes: { type: string; hoursAgo: number }[];
}): SignalDecision {
  const { tier, sec, pool, result, previousScore, recentSignalTypes } = opts;
  if (tier === "full" && sec) {
    return decideSignal({ sec, pool, result, previousScore, recentSignalTypes });
  }

  const recent = (type: string, withinH: number) =>
    recentSignalTypes.some((s) => s.type === type && s.hoursAgo < withinH);
  const txns = pool.buys1h + pool.sells1h;
  const buyRatio = txns > 0 ? pool.buys1h / txns : 0;

  // ENTRY — rug-checked coins can fire early (the sell path is proven);
  // market-only coins need overwhelming flow to compensate.
  const entryBar =
    tier === "rug"
      ? result.score >= 55 && buyRatio >= 0.6 && txns >= 15 && pool.liquidityUsd >= 15_000
      : result.score >= 48 && buyRatio >= 0.65 && txns >= 25 && pool.liquidityUsd >= 25_000;
  if (entryBar && !recent("ENTRY", 6)) {
    const verified =
      tier === "rug"
        ? "Sell path verified by live simulation; registry gates still pending"
        : "No security registry on this chain — market-structure read only";
    return {
      type: "ENTRY",
      reasoning:
        `Score ${result.score} with ${Math.round(buyRatio * 100)}% of the last hour's ${txns} trades buying ` +
        `and ${usd(pool.liquidityUsd)} liquidity. ${verified}. Early-tier entry — size accordingly.`,
    };
  }

  // EXIT — same drop rules as the full tier
  if (
    previousScore !== null &&
    (previousScore - result.score >= 20 || (previousScore >= 55 && result.score < 40)) &&
    !recent("EXIT", 6)
  ) {
    return {
      type: "EXIT",
      reasoning:
        `Score dropped from ${previousScore} to ${result.score}; buy share ${Math.round(buyRatio * 100)}%, ` +
        `24h ${pool.priceChange24h.toFixed(1)}%. Momentum is unwinding — re-read before holding on.`,
    };
  }

  // RISK — dumping or a failing structure read
  if (
    (result.flags.includes("DUMPING") || result.flags.includes("SELL_TRAP")) &&
    result.score < 45 &&
    !recent("RISK", 24)
  ) {
    return {
      type: "RISK",
      reasoning:
        `Scored ${result.score}: ${result.flags.includes("SELL_TRAP") ? "sell-tax asymmetry reads as an exit trap; " : ""}` +
        `price ${pool.priceChange1h.toFixed(1)}% (1h) / ${pool.priceChange6h.toFixed(1)}% (6h). ` +
        `Flow is working against holders.`,
    };
  }

  return null;
}

function usd(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
}
