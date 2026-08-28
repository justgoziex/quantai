import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/* GET /api/admin/overview — platform analytics in one call. */
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const [
    usersTotal,
    usersNew7d,
    usersActive1d,
    usersActive30d,
    usersSuspended,
    tokensTotal,
    tokensByCategory,
    tokensBlacklisted,
    tokensFresh,
    signals24h,
    signals7d,
    signalsByType,
    referralsByStatus,
    pointsIssued,
    trades24h,
    tradesTotal,
    launchesTotal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { updatedAt: { gte: dayAgo } } }),
    prisma.user.count({ where: { updatedAt: { gte: monthAgo } } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.token.count(),
    prisma.token.groupBy({ by: ["category"], _count: true }),
    prisma.token.count({ where: { blacklisted: true } }),
    prisma.token.count({ where: { updatedAt: { gte: new Date(Date.now() - 120_000) } } }),
    prisma.signal.count({ where: { firedAt: { gte: dayAgo } } }),
    prisma.signal.count({ where: { firedAt: { gte: weekAgo } } }),
    prisma.signal.groupBy({ by: ["type"], _count: true, where: { firedAt: { gte: weekAgo } } }),
    prisma.referral.groupBy({ by: ["status"], _count: true }),
    prisma.rewardLedger.aggregate({ _sum: { points: true } }),
    prisma.trade.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.trade.count(),
    prisma.launchConfig.count(),
  ]);

  return NextResponse.json({
    users: {
      total: usersTotal,
      new7d: usersNew7d,
      dau: usersActive1d, // activity proxy: row updated in window
      mau: usersActive30d,
      suspended: usersSuspended,
    },
    tokens: {
      total: tokensTotal,
      byCategory: Object.fromEntries(tokensByCategory.map((t) => [t.category, t._count])),
      blacklisted: tokensBlacklisted,
      freshWithin2min: tokensFresh,
    },
    signals: {
      last24h: signals24h,
      last7d: signals7d,
      byType7d: Object.fromEntries(signalsByType.map((s) => [s.type, s._count])),
    },
    referrals: Object.fromEntries(referralsByStatus.map((r) => [r.status, r._count])),
    rewards: { pointsIssued: pointsIssued._sum.points ?? 0 },
    activity: { trades24h, tradesTotal, launchesTotal },
  });
}
