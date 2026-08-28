import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";

export const dynamic = "force-dynamic";

/*
  Price alerts — one-shot triggers on a token's live USD price.
  GET    → the caller's alerts (with token info).
  POST   → { tokenId, direction: ABOVE|BELOW, priceUsd } create.
  DELETE → { id } remove.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const alerts = await prisma.priceAlert.findMany({
    where: { userId: res.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { token: { select: { symbol: true, name: true, chain: true, address: true, market: true } } },
  });
  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      direction: a.direction,
      priceUsd: a.priceUsd,
      active: a.active,
      triggeredAt: a.triggeredAt,
      createdAt: a.createdAt,
      token: {
        symbol: a.token.symbol,
        name: a.token.name,
        chain: a.token.chain,
        address: a.token.address,
        priceUsd: (a.token.market as { priceUsd?: number } | null)?.priceUsd ?? null,
      },
    })),
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    tokenId?: string;
    direction?: string;
    priceUsd?: number;
  } | null;
  if (!body?.tokenId) return badRequest("tokenId is required.");
  const direction = body.direction === "BELOW" ? "BELOW" : "ABOVE";
  const priceUsd = Number(body.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return badRequest("Enter a valid target price.");

  const token = await prisma.token.findFirst({ where: { id: body.tokenId, blacklisted: false }, select: { id: true } });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const count = await prisma.priceAlert.count({ where: { userId: res.user.id, active: true } });
  if (count >= 50) return badRequest("Alert limit reached — remove some first.");

  const alert = await prisma.priceAlert.create({
    data: { userId: res.user.id, tokenId: token.id, direction, priceUsd },
  });
  return NextResponse.json({ alert }, { status: 201 });
}

export async function DELETE(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return badRequest("id is required.");
  await prisma.priceAlert.deleteMany({ where: { id, userId: res.user.id } });
  return NextResponse.json({ ok: true });
}
