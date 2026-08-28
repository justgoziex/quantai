import { prisma } from "./db";
import { getRewardConfig, getRewardSwitches, isKilled } from "./config";

/*
  Rewards engine — all rewards are denominated in ETH and vest 30 days after
  accrual. Internally the ledger stores integer POINTS where 1 point = 1 µETH
  (1e-6 ETH), so amounts stay exact.

  Referral lifecycle: PENDING on sign-up with a code → QUALIFIED when the
  referred account does its first real action (a trade log or a launch).
  Qualification pays the REFERRER; activity pays the ACTOR.

  Every reward stream has an admin on/off switch (config "rewardSwitches").
  Anti-abuse: self-referrals are blocked at attribution (same account or
  same device fingerprint); forfeiture on abuse flips ledger via FORFEIT.
*/
export const POINTS_PER_ETH = 1_000_000;

export function pointsToEth(points: number): number {
  return points / POINTS_PER_ETH;
}

/* "0.0025 ETH" style display; trims trailing zeros, never shows sci-notation. */
export function fmtEth(points: number): string {
  const eth = pointsToEth(points);
  if (eth === 0) return "0 ETH";
  const s = Math.abs(eth) >= 0.01 ? eth.toFixed(4) : eth.toFixed(6);
  return `${s.replace(/\.?0+$/, "")} ETH`;
}

/*
  Trading cashback — ETH back on every trade, proportional to USD volume.
  basePerUsd is the fish-tier rate in µETH per $1 of volume; the trader's
  volume tier multiplies it. Small trades are floored, each trade is capped to
  blunt wash-trading, and dust trades below minVolumeUsd earn nothing.
*/
export const CASHBACK = {
  basePerUsd: 20, // fish tier: 20 µETH per $1 → $1,000 volume ≈ 0.02 ETH
  minVolumeUsd: 10, // dust trades don't earn cashback
  floorPoints: 100, // a qualifying trade earns at least 0.0001 ETH
  maxPerTrade: 100_000, // cap 0.1 ETH per single trade (anti-wash)
} as const;

const VESTING_DAYS = 30;

export function tierOf(qualified: number): { name: string; sharePct: number } {
  if (qualified >= 20) return { name: "Desk", sharePct: 20 };
  if (qualified >= 5) return { name: "Operator", sharePct: 15 };
  if (qualified >= 1) return { name: "Scout", sharePct: 10 };
  return { name: "—", sharePct: 0 };
}

/*
  Volume tier — rewards traders who put through real flow. Multiplier scales
  the cashback rate; thresholds are lifetime USD volume across all trades.
*/
export function volumeTierOf(volumeUsd: number): {
  name: string;
  multiplier: number;
  nextAt: number | null;
} {
  if (volumeUsd >= 500_000) return { name: "Whale", multiplier: 2.5, nextAt: null };
  if (volumeUsd >= 100_000) return { name: "Shark", multiplier: 2, nextAt: 500_000 };
  if (volumeUsd >= 25_000) return { name: "Runner", multiplier: 1.5, nextAt: 100_000 };
  if (volumeUsd >= 5_000) return { name: "Active", multiplier: 1.25, nextAt: 25_000 };
  return { name: "Fish", multiplier: 1, nextAt: 5_000 };
}

/* Cashback points a single trade earns, given the trader's tier multiplier. */
export function cashbackPoints(volumeUsd: number, multiplier: number): number {
  if (!Number.isFinite(volumeUsd) || volumeUsd < CASHBACK.minVolumeUsd) return 0;
  const raw = volumeUsd * CASHBACK.basePerUsd * multiplier;
  return Math.min(CASHBACK.maxPerTrade, Math.max(CASHBACK.floorPoints, Math.round(raw)));
}

function vestsAt(): Date {
  return new Date(Date.now() + VESTING_DAYS * 86_400_000);
}

export async function awardPoints(
  userId: string,
  points: number,
  reason: "REFERRAL" | "ACTIVITY" | "BONUS",
  meta?: Record<string, string>,
) {
  await prisma.rewardLedger.create({
    data: { userId, points, reason, meta: meta ?? {}, vestsAt: vestsAt() },
  });
}

/*
  Called after a user's qualifying action. Idempotent: qualifies at most
  once, pays the referrer exactly once. Never throws — rewards must not
  break the action that triggered them.
*/
export async function onQualifyingAction(
  userId: string,
  action: "trade" | "launch",
  opts?: { volumeUsd?: number },
) {
  try {
    if (await isKilled("rewards")) return; // global admin kill switch
    const [points, switches] = await Promise.all([getRewardConfig(), getRewardSwitches()]);

    // activity rewards for the actor — each stream individually switchable
    if (action === "launch") {
      if (switches.launch) {
        await awardPoints(userId, points.launch, "ACTIVITY", { action });
      }
    } else {
      if (switches.firstTrade) {
        const tradeCount = await prisma.trade.count({ where: { userId, demo: false } });
        if (tradeCount === 1) {
          await awardPoints(userId, points.firstTrade, "ACTIVITY", { action: "first-trade" });
        }
      }

      // volume-based cashback on every trade, scaled by lifetime volume tier
      if (switches.tradeCashback) {
        const volumeUsd = Number(opts?.volumeUsd ?? 0);
        if (volumeUsd >= CASHBACK.minVolumeUsd) {
          const lifetime = await tradeVolumeUsd(userId);
          const tier = volumeTierOf(lifetime);
          const earned = cashbackPoints(volumeUsd, tier.multiplier);
          if (earned > 0) {
            await awardPoints(userId, earned, "ACTIVITY", {
              action: "cashback",
              volumeUsd: volumeUsd.toFixed(2),
              tier: tier.name,
            });
          }
        }
      }
    }

    // qualify a pending referral for the referrer
    if (switches.referral) {
      const referral = await prisma.referral.findUnique({
        where: { referredUserId: userId },
      });
      if (referral && referral.status === "PENDING") {
        await prisma.referral.update({
          where: { id: referral.id },
          data: { status: "QUALIFIED", qualifiedAt: new Date() },
        });
        await awardPoints(referral.referrerId, points.referralQualified, "REFERRAL", {
          referredUserId: userId,
          action: String(action),
        });
      }
    }
  } catch (e) {
    console.error("rewards hook failed:", (e as Error).message);
  }
}

/*
  Lifetime USD trade volume for a user (sum of amountToken × priceUsd).
  Postgres can't multiply two columns in a Prisma aggregate, so we sum the
  product in code — a user's trade count is bounded enough for this.
*/
export async function tradeVolumeUsd(userId: string): Promise<number> {
  const trades = await prisma.trade.findMany({
    where: { userId, demo: false }, // simulated trades never earn rewards
    select: { amountToken: true, priceUsd: true },
  });
  return trades.reduce((sum, t) => sum + t.amountToken * t.priceUsd, 0);
}
