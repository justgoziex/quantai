import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { tierOf, volumeTierOf, tradeVolumeUsd } from "@/lib/rewards";

/* GET /api/referral — code, tier, referral counts, points, recent ledger. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const [code, referrals, points, vested, ledger, tradeCount, volumeUsd, cashback] =
    await Promise.all([
      prisma.referralCode.findUnique({ where: { userId: res.user.id } }),
      prisma.referral.groupBy({
        by: ["status"],
        where: { referrerId: res.user.id },
        _count: true,
      }),
      prisma.rewardLedger.aggregate({ where: { userId: res.user.id }, _sum: { points: true } }),
      prisma.rewardLedger.aggregate({
        where: { userId: res.user.id, vestsAt: { lte: new Date() }, settledAt: null },
        _sum: { points: true },
      }),
      prisma.rewardLedger.findMany({
        where: { userId: res.user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, points: true, reason: true, vestsAt: true, settledAt: true, createdAt: true, meta: true },
      }),
      prisma.trade.count({ where: { userId: res.user.id } }),
      tradeVolumeUsd(res.user.id),
      prisma.rewardLedger.aggregate({
        where: { userId: res.user.id, meta: { path: ["action"], equals: "cashback" } },
        _sum: { points: true },
      }),
    ]);

  const counts = Object.fromEntries(referrals.map((r) => [r.status, r._count]));
  const qualified = counts.QUALIFIED ?? 0;
  const volTier = volumeTierOf(volumeUsd);

  return NextResponse.json({
    code: code?.code ?? null,
    tier: tierOf(qualified),
    referrals: {
      pending: counts.PENDING ?? 0,
      qualified,
      forfeited: counts.FORFEITED ?? 0,
    },
    trading: {
      trades: tradeCount,
      volumeUsd,
      tier: volTier.name,
      multiplier: volTier.multiplier,
      nextTierAt: volTier.nextAt,
      cashbackPoints: cashback._sum.points ?? 0,
    },
    points: points._sum.points ?? 0,
    vestedUnsettled: vested._sum.points ?? 0,
    ledger,
  });
}
