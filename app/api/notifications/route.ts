import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";

/* GET /api/notifications — the caller's feed, newest first. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";

  const notifications = await prisma.notification.findMany({
    where: { userId: res.user.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ notifications });
}

/* POST /api/notifications { ids?: string[] } — mark read (all if omitted). */
export async function POST(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] };

  await prisma.notification.updateMany({
    where: {
      userId: res.user.id,
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
