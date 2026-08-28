import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { getAnnouncement } from "@/lib/config";

export const dynamic = "force-dynamic";

/* GET /api/announcement — public site banner (empty when disabled). */
export async function GET() {
  if (!dbConfigured) return NextResponse.json({ enabled: false, text: "" });
  const a = await getAnnouncement();
  return NextResponse.json(a);
}
