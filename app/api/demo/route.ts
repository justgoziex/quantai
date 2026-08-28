import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { getNativeUsd } from "@/lib/native-price";

/*
  Demo (paper) trading — simulated trades against a USD cash balance at live
  prices. No on-chain money. The UI gives no indication it's a demo; it only
  behaves differently because these endpoints back the trade/portfolio flows
  when the caller's demo account is enabled.

  GET  → { enabled, cashUsd, nativeUsd } (nativeUsd lets the client price the
         native-denominated trade input in USD).
  POST → record a simulated trade, moving cashUsd.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const tokenId = new URL(req.url).searchParams.get("tokenId");
  const [demo, nativeUsd, heldToken] = await Promise.all([
    prisma.demoAccount.findUnique({ where: { userId: res.user.id } }),
    getNativeUsd(),
    tokenId ? heldQty(res.user.id, tokenId) : Promise.resolve(0),
  ]);
  return NextResponse.json({
    enabled: demo?.enabled ?? false,
    cashUsd: demo?.cashUsd ?? 0,
    nativeUsd,
    heldToken,
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const demo = await prisma.demoAccount.findUnique({ where: { userId: res.user.id } });
  if (!demo || !demo.enabled) return badRequest("Demo trading isn't active.");

  const body = (await req.json().catch(() => null)) as {
    tokenId?: string;
    side?: string;
    amountToken?: number;
    priceUsd?: number;
  } | null;
  if (!body?.tokenId) return badRequest("tokenId is required.");
  const side = body.side?.toUpperCase();
  if (side !== "BUY" && side !== "SELL") return badRequest("Side must be BUY or SELL.");
  const amountToken = Number(body.amountToken);
  const priceUsd = Number(body.priceUsd);
  if (!Number.isFinite(amountToken) || amountToken <= 0) return badRequest("Amount must be positive.");
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return badRequest("Price unavailable.");

  const token = await prisma.token.findFirst({ where: { id: body.tokenId, blacklisted: false } });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });

  const usd = amountToken * priceUsd;

  if (side === "BUY") {
    if (usd > demo.cashUsd + 1e-6) return badRequest("Not enough demo balance for this trade.");
  } else {
    // can't sell more than held (demo positions from demo trades)
    const held = await heldQty(res.user.id, token.id);
    if (amountToken > held + 1e-9) return badRequest("You don't hold that much to sell.");
  }

  const nextCash = side === "BUY" ? demo.cashUsd - usd : demo.cashUsd + usd;
  await prisma.$transaction([
    prisma.trade.create({
      data: {
        userId: res.user.id,
        tokenId: token.id,
        side,
        amountToken,
        amountNative: 0,
        priceUsd,
        source: "MANUAL",
        demo: true,
      },
    }),
    prisma.demoAccount.update({
      where: { userId: res.user.id },
      data: { cashUsd: nextCash },
    }),
  ]);

  return NextResponse.json({ ok: true, cashUsd: nextCash });
}

async function heldQty(userId: string, tokenId: string): Promise<number> {
  const trades = await prisma.trade.findMany({
    where: { userId, tokenId, demo: true },
    select: { side: true, amountToken: true },
  });
  return trades.reduce((q, t) => q + (t.side === "BUY" ? t.amountToken : -t.amountToken), 0);
}
