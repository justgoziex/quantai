import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable } from "@/lib/api";

/* GET /api/signals — latest signals across the feed. Query: limit, type. */
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  const type = url.searchParams.get("type")?.toUpperCase();

  const signals = await prisma.signal.findMany({
    where: type === "ENTRY" || type === "EXIT" || type === "RISK" ? { type } : {},
    orderBy: { firedAt: "desc" },
    take: limit,
    include: {
      token: {
        select: { chain: true, address: true, name: true, symbol: true, currentScore: true },
      },
    },
  });

  return NextResponse.json({ signals });
}
