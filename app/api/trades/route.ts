import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, badRequest } from "@/lib/api";
import { onQualifyingAction } from "@/lib/rewards";

/* GET /api/trades — the caller's trade log, newest first. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const trades = await prisma.trade.findMany({
    where: { userId: res.user.id },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: { token: { select: { symbol: true, name: true, chain: true, address: true } } },
  });
  return NextResponse.json({ trades });
}

/* POST /api/trades — log a trade (manual entry, or an executed on-chain swap). */
export async function POST(req: Request) {
  const { isKilled } = await import("@/lib/config");
  if (await isKilled("trading")) {
    return NextResponse.json(
      { error: "Trading is temporarily disabled by the operators." },
      { status: 503 },
    );
  }
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    tokenId?: string;
    side?: string;
    amountToken?: number;
    amountNative?: number;
    priceUsd?: number;
    occurredAt?: string;
    txHash?: string;
    executed?: boolean;
  } | null;
  if (!body) return badRequest("Missing trade payload.");

  const side = body.side?.toUpperCase();
  if (side !== "BUY" && side !== "SELL") return badRequest("Side must be BUY or SELL.");
  const amount = Number(body.amountToken);
  const price = Number(body.priceUsd);
  if (!Number.isFinite(amount) || amount <= 0) return badRequest("Amount must be positive.");
  if (!Number.isFinite(price) || price < 0) return badRequest("Price must be zero or more.");
  if (!body.tokenId) return badRequest("tokenId is required.");

  const token = await prisma.token.findFirst({ where: { id: body.tokenId, blacklisted: false } });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return badRequest("Invalid occurredAt.");

  const trade = await prisma.trade.create({
    data: {
      userId: res.user.id,
      tokenId: token.id,
      side,
      amountToken: amount,
      amountNative: Number.isFinite(Number(body.amountNative)) ? Number(body.amountNative) : 0,
      priceUsd: price,
      source: body.executed && body.txHash ? "EXECUTED" : "MANUAL",
      txHash: body.txHash ?? null,
      occurredAt,
    },
  });
  await onQualifyingAction(res.user.id, "trade", { volumeUsd: amount * price });
  return NextResponse.json({ trade }, { status: 201 });
}

/* DELETE /api/trades { id } — remove one of the caller's trades. Deleting a
   demo trade reverses its cash movement so the simulated balance stays true. */
export async function DELETE(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return badRequest("id is required.");

  const trade = await prisma.trade.findFirst({ where: { id, userId: res.user.id } });
  if (!trade) return NextResponse.json({ ok: true });

  if (trade.demo) {
    const usd = trade.amountToken * trade.priceUsd;
    const delta = trade.side === "BUY" ? usd : -usd; // undo the original move
    await prisma.$transaction([
      prisma.trade.delete({ where: { id: trade.id } }),
      prisma.demoAccount.update({
        where: { userId: res.user.id },
        data: { cashUsd: { increment: delta } },
      }),
    ]);
  } else {
    await prisma.trade.delete({ where: { id: trade.id } });
  }
  return NextResponse.json({ ok: true });
}
