import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getSystemStatus } from "@/lib/status";
import { runIngest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* GET /api/status — live system health, public. */
export async function GET() {
  // checking status also heals it: kick a (self-throttled, DB-locked) ingest
  // pass so stale chains catch up even when the site is otherwise idle
  waitUntil(runIngest().catch(() => {}));
  const status = await getSystemStatus();
  return NextResponse.json(status, {
    headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
