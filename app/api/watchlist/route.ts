import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, badRequest } from "@/lib/api";

/* GET /api/watchlist — tokens the caller tracks. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  // blacklisted tokens are hidden site-wide, watchlists included
  const items = await prisma.watchlist.findMany({
    where: { userId: res.user.id, token: { blacklisted: false } },
    include: { token: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ watchlist: items });
}

/* POST /api/watchlist { tokenId } — add. */
export async function POST(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { tokenId } = (await req.json().catch(() => ({}))) as { tokenId?: string };
  if (!tokenId) return badRequest("tokenId is required.");

  const token = await prisma.token.findFirst({ where: { id: tokenId, blacklisted: false } });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const item = await prisma.watchlist.upsert({
    where: { userId_tokenId: { userId: res.user.id, tokenId } },
    update: {},
    create: { userId: res.user.id, tokenId },
  });
  return NextResponse.json({ item }, { status: 201 });
}

/* DELETE /api/watchlist { tokenId } — remove. */
export async function DELETE(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { tokenId } = (await req.json().catch(() => ({}))) as { tokenId?: string };
  if (!tokenId) return badRequest("tokenId is required.");

  await prisma.watchlist.deleteMany({ where: { userId: res.user.id, tokenId } });
  return NextResponse.json({ ok: true });
}
