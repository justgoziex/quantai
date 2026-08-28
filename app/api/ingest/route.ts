import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { dbUnavailable } from "@/lib/api";
import { runIngest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
  POST /api/ingest — the ingest pass. In production a Vercel Cron calls this
  every minute (the in-process loop is disabled on serverless); locally it's
  also triggered by clients and the background loop. Self-throttled (30s) and
  idempotent, so overlapping triggers are safe.
*/
export async function POST() {
  if (!dbConfigured) return dbUnavailable();
  const result = await runIngest();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return POST();
}
