import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { requireAdmin, auditLog } from "@/lib/admin";

export const dynamic = "force-dynamic";

/*
  Admin redemption queue — the admin pays each request manually (ETH to the
  user's chosen wallet), then marks it PAID. REJECTED re-credits the ledger.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;
  const requests = await prisma.redemptionRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { user: { select: { email: true } } },
  });
  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      userEmail: r.user?.email ?? null,
      points: r.points,
      wallet: r.wallet,
      feeTxHash: r.feeTxHash,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
    })),
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    action?: "paid" | "reject";
    note?: string;
  } | null;
  if (!body?.id || !body.action) return badRequest("id and action are required.");

  const request = await prisma.redemptionRequest.findUnique({ where: { id: body.id } });
  if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (request.status !== "PENDING") return badRequest("Request already resolved.");

  if (body.action === "paid") {
    await prisma.redemptionRequest.update({
      where: { id: request.id },
      data: { status: "PAID", paidAt: new Date(), adminNote: body.note?.slice(0, 200) ?? null },
    });
  } else {
    // reject → return the locked amount to the user's ledger
    await prisma.$transaction([
      prisma.redemptionRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", adminNote: body.note?.slice(0, 200) ?? null },
      }),
      prisma.rewardLedger.create({
        data: {
          userId: request.userId,
          points: request.points,
          reason: "ACTIVITY",
          meta: { action: "redeem-returned" },
          vestsAt: new Date(),
        },
      }),
    ]);
  }

  await auditLog(res.user.id, `redemption.${body.action}`, "RedemptionRequest", request.id, {
    points: request.points,
    wallet: request.wallet,
  });
  return NextResponse.json({ ok: true });
}
