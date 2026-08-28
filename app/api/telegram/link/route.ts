import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, dbUnavailable } from "@/lib/api";
import { telegramConfigured, isLinkedEndpoint } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const BOT = process.env.TELEGRAM_BOT_USERNAME ?? "";

/*
  Telegram linking.
  GET  → { configured, linked, botUsername, code? } current status.
  POST → mint a fresh one-time code; user opens t.me/<bot>?start=<code> and
         the webhook binds their chat id to this account.
  DELETE → unlink.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const ch = await prisma.alertChannel.findUnique({
    where: { userId_type: { userId: res.user.id, type: "TELEGRAM" } },
  });
  const linked = Boolean(ch?.enabled && isLinkedEndpoint(ch.endpoint));
  const code = ch?.endpoint?.startsWith("code:") ? ch.endpoint.slice(5) : null;
  return NextResponse.json({ configured: telegramConfigured, linked, botUsername: BOT, code });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const code = Math.random().toString(36).slice(2, 10);
  await prisma.alertChannel.upsert({
    where: { userId_type: { userId: res.user.id, type: "TELEGRAM" } },
    update: { endpoint: `code:${code}`, enabled: true },
    create: { userId: res.user.id, type: "TELEGRAM", endpoint: `code:${code}`, enabled: true },
  });
  return NextResponse.json({ code, botUsername: BOT, configured: telegramConfigured });
}

export async function DELETE(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  await prisma.alertChannel.deleteMany({ where: { userId: res.user.id, type: "TELEGRAM" } });
  return NextResponse.json({ ok: true });
}
