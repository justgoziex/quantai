import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { requireAdmin, auditLog } from "@/lib/admin";

/*
  Admin control for the caller's own demo (paper) trading account.
  GET  → current demo state.
  POST → { enabled?, cashUsd?, reset? } — toggle demo, set the balance, and
         optionally wipe simulated positions. Setting cashUsd resets the cash.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;
  const demo = await prisma.demoAccount.findUnique({ where: { userId: res.user.id } });
  return NextResponse.json({
    enabled: demo?.enabled ?? false,
    cashUsd: demo?.cashUsd ?? 0,
    startingCashUsd: demo?.startingCashUsd ?? 0,
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    enabled?: boolean;
    cashUsd?: number;
    reset?: boolean;
  } | null;
  if (!body) return badRequest("Missing payload.");

  const existing = await prisma.demoAccount.findUnique({ where: { userId: res.user.id } });
  const enabled = body.enabled ?? existing?.enabled ?? false;
  const setCash = body.cashUsd !== undefined && Number.isFinite(Number(body.cashUsd));
  const cash = setCash ? Math.max(0, Number(body.cashUsd)) : (existing?.cashUsd ?? 0);
  const starting = setCash ? cash : (existing?.startingCashUsd ?? cash);

  await prisma.demoAccount.upsert({
    where: { userId: res.user.id },
    update: { enabled, cashUsd: cash, startingCashUsd: starting },
    create: { userId: res.user.id, enabled, cashUsd: cash, startingCashUsd: starting },
  });

  // wipe simulated positions on reset or whenever a fresh balance is set
  if (body.reset || setCash) {
    await prisma.trade.deleteMany({ where: { userId: res.user.id, demo: true } });
  }

  await auditLog(res.user.id, "demo.config", "DemoAccount", res.user.id, {
    enabled,
    cashUsd: cash,
    reset: Boolean(body.reset || setCash),
  });

  return NextResponse.json({ ok: true, enabled, cashUsd: cash, startingCashUsd: starting });
}
