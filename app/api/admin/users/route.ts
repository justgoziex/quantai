import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, auditLog } from "@/lib/admin";
import { badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/* GET /api/admin/users?q= — search users by email/privyId. */
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { privyId: { contains: q } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      redemptionFeeEth: true,
      createdAt: true,
      updatedAt: true,
      wallets: { select: { address: true } },
      _count: { select: { trades: true, launches: true, referralsMade: true } },
    },
  });
  return NextResponse.json({ users });
}

/* POST /api/admin/users — suspend/activate/role changes, grant points, or
   set a per-user redemption (network) fee. */
const ACTIONS = ["suspend", "activate", "makeAdmin", "revokeAdmin", "grantPoints", "setRedemptionFee"] as const;

export async function POST(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const { userId, action, points, feeEth } = (await req.json().catch(() => ({}))) as {
    userId?: string;
    action?: (typeof ACTIONS)[number];
    points?: number;
    feeEth?: number | null;
  };
  if (!userId || !action || !ACTIONS.includes(action)) {
    return badRequest("userId and a valid action are required.");
  }
  if (userId === res.user.id && (action === "suspend" || action === "revokeAdmin")) {
    return badRequest("You can't suspend or demote your own account.");
  }

  if (action === "setRedemptionFee") {
    // null clears the override (falls back to the global fee)
    const fee =
      feeEth === null || feeEth === undefined || feeEth === ("" as unknown)
        ? null
        : Math.max(0, Number(feeEth));
    if (fee !== null && !Number.isFinite(fee)) return badRequest("Enter a valid ETH fee.");
    await prisma.user.update({ where: { id: userId }, data: { redemptionFeeEth: fee } });
    await auditLog(res.user.id, "user.setRedemptionFee", "User", userId, { feeEth: fee });
    return NextResponse.json({ ok: true });
  }

  if (action === "grantPoints") {
    const amt = Math.round(Number(points));
    if (!Number.isFinite(amt) || amt === 0) return badRequest("Enter a non-zero point amount.");
    await prisma.rewardLedger.create({
      data: {
        userId,
        points: amt,
        reason: "BONUS",
        meta: { grantedBy: res.user.id },
        vestsAt: new Date(), // admin grants vest immediately
      },
    });
    await auditLog(res.user.id, "user.grantPoints", "User", userId, { points: amt });
    return NextResponse.json({ ok: true });
  }

  const data =
    action === "suspend"
      ? { status: "SUSPENDED" as const }
      : action === "activate"
        ? { status: "ACTIVE" as const }
        : action === "makeAdmin"
          ? { role: "ADMIN" as const }
          : { role: "USER" as const };

  const user = await prisma.user.update({ where: { id: userId }, data });
  await auditLog(res.user.id, `user.${action}`, "User", userId, { email: user.email });
  return NextResponse.json({ ok: true, user: { id: user.id, role: user.role, status: user.status } });
}
