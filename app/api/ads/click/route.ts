import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/* POST /api/ads/click { id, kind } — impression/click counters for advertisers. */
export async function POST(req: Request) {
  if (!dbConfigured) return NextResponse.json({ ok: true });
  const { id, kind } = (await req.json().catch(() => ({}))) as { id?: string; kind?: string };
  if (!id) return NextResponse.json({ ok: true });
  await prisma.adCampaign
    .update({
      where: { id },
      data: kind === "impression" ? { impressions: { increment: 1 } } : { clicks: { increment: 1 } },
    })
    .catch(() => {});
  return NextResponse.json({ ok: true });
}
