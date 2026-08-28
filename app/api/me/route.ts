import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";

/* GET /api/me — profile, wallets, referral code, quick counts. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { user } = res;

  const [full, watchlistCount, points] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      include: { wallets: true, referralCode: true },
    }),
    prisma.watchlist.count({ where: { userId: user.id } }),
    prisma.rewardLedger.aggregate({ where: { userId: user.id }, _sum: { points: true } }),
  ]);

  return NextResponse.json({
    id: full!.id,
    email: full!.email,
    role: full!.role,
    wallets: full!.wallets.map((w) => w.address),
    referralCode: full!.referralCode?.code ?? null,
    watchlistCount,
    points: points._sum.points ?? 0,
    onboardedAt: full!.onboardedAt,
  });
}
