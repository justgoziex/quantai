import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/*
  GET   /api/admin/cashback — creator claims waiting on the desk.
  PATCH /api/admin/cashback — approve, reject, or mark one paid.

  Settlement is deliberately manual. Nothing here moves funds; it records what
  the desk decided and what it sent, so approving a payout and making it stay
  separate acts. The payout wallet is shown in full — a truncated address is
  useless to someone about to send money to it.
*/
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const claims = await prisma.devCashbackClaim.findMany({
    where: status && status !== "ALL" ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      chain: true,
      tokenAddress: true,
      symbol: true,
      tokenScore: true,
      liquidityUsd: true,
      volume24hUsd: true,
      amountNative: true,
      asset: true,
      payoutWallet: true,
      status: true,
      adminNote: true,
      createdAt: true,
      reviewedAt: true,
      paidAt: true,
      payoutTxHash: true,
      dev: { select: { wallet: true, user: { select: { email: true } } } },
    },
  });

  // what's outstanding, per asset — the desk needs to know what it owes
  const owed = new Map<string, number>();
  for (const c of claims) {
    if (c.status === "PENDING" || c.status === "APPROVED") {
      owed.set(c.asset, (owed.get(c.asset) ?? 0) + c.amountNative);
    }
  }

  return NextResponse.json({
    claims,
    owed: Object.fromEntries([...owed.entries()].map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])),
  });
}

export async function PATCH(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    adminNote?: string;
    payoutTxHash?: string;
  };
  const id = String(body.id ?? "");
  const status = String(body.status ?? "").toUpperCase();
  if (!id) return NextResponse.json({ error: "Which claim?" }, { status: 400 });
  if (!["APPROVED", "REJECTED", "PAID", "PENDING"].includes(status)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const claim = await prisma.devCashbackClaim.update({
    where: { id },
    data: {
      status,
      adminNote: body.adminNote ? String(body.adminNote).slice(0, 300) : undefined,
      payoutTxHash: body.payoutTxHash ? String(body.payoutTxHash).slice(0, 120) : undefined,
      reviewedAt: new Date(),
      // only marking it paid records when the money actually left
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
    },
    select: { id: true, status: true, paidAt: true },
  });

  return NextResponse.json({ claim });
}
