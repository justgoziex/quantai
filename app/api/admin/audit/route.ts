import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/* GET /api/admin/audit — the append-only admin action log, newest first. */
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const entries = await prisma.adminActionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { admin: { select: { email: true } } },
  });
  return NextResponse.json({ entries });
}
