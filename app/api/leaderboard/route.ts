import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable } from "@/lib/api";
import { tierOf } from "@/lib/rewards";

export const dynamic = "force-dynamic";

/*
  GET /api/leaderboard — public, PII-free: referral codes as handles,
  ranked by qualified referrals then total points.
*/
export async function GET() {
  if (!dbConfigured) return dbUnavailable();

  const referrers = await prisma.referral.groupBy({
    by: ["referrerId"],
    where: { status: "QUALIFIED" },
    _count: true,
    orderBy: { _count: { referrerId: "desc" } },
    take: 10,
  });

  const rows = await Promise.all(
    referrers.map(async (r) => {
      const [code, points] = await Promise.all([
        prisma.referralCode.findUnique({ where: { userId: r.referrerId } }),
        prisma.rewardLedger.aggregate({
          where: { userId: r.referrerId },
          _sum: { points: true },
        }),
      ]);
      return {
        handle: code?.code ?? "————",
        qualified: r._count,
        points: points._sum.points ?? 0,
        tier: tierOf(r._count).name,
      };
    }),
  );

  rows.sort((a, b) => b.qualified - a.qualified || b.points - a.points);
  return NextResponse.json({ leaderboard: rows });
}
