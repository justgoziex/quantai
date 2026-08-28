import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { requireAdmin, auditLog } from "@/lib/admin";
import { awardPoints } from "@/lib/rewards";
import { getWalletPolicy, setConfig, DEFAULT_WALLET_POLICY } from "@/lib/config";

/*
  GET  /api/admin/wallets — every connected external wallet + the cashback
       policy text.
  POST /api/admin/wallets — either update the policy ({ policy: {...} }) or
       award/adjust cashback for one wallet ({ id, cashbackPoints, note }).
       Setting cashback credits the DELTA to that user's reward ledger.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const [wallets, policy] = await Promise.all([
    prisma.externalWallet.findMany({
      orderBy: [{ reviewedAt: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { user: { select: { email: true } } },
    }),
    getWalletPolicy(),
  ]);

  return NextResponse.json({
    policy,
    wallets: wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      verified: w.verified,
      cashbackPoints: w.cashbackPoints,
      activity: w.activity ?? null,
      adminNote: w.adminNote,
      reviewedAt: w.reviewedAt,
      createdAt: w.createdAt,
      userEmail: w.user?.email ?? null,
    })),
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    policy?: {
      text?: string;
      defaultPoints?: number;
      ethPerTradedToken?: number;
      maxCashbackEth?: number;
    };
    id?: string;
    cashbackPoints?: number;
    cashbackEth?: number; // ETH-denominated award (1 ETH = 1e6 points)
    note?: string;
  } | null;
  if (!body) return badRequest("Missing payload.");

  // update the public cashback policy (what determines the award)
  if (body.policy) {
    const num = (v: unknown, fb: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : fb;
    };
    const policy = {
      text: String(body.policy.text ?? DEFAULT_WALLET_POLICY.text).slice(0, 600),
      defaultPoints: Math.max(0, Math.round(Number(body.policy.defaultPoints ?? 0))),
      ethPerTradedToken: num(body.policy.ethPerTradedToken, DEFAULT_WALLET_POLICY.ethPerTradedToken),
      maxCashbackEth: num(body.policy.maxCashbackEth, DEFAULT_WALLET_POLICY.maxCashbackEth),
    };
    await setConfig("externalWalletPolicy", policy);
    await auditLog(res.user.id, "setWalletPolicy", "config", "externalWalletPolicy", policy);
    return NextResponse.json({ ok: true, policy });
  }

  // award / adjust cashback for one wallet (ETH input preferred)
  if (!body.id) return badRequest("Wallet id is required.");
  const points =
    body.cashbackEth !== undefined
      ? Math.max(0, Math.round(Number(body.cashbackEth) * 1_000_000))
      : Math.max(0, Math.round(Number(body.cashbackPoints ?? 0)));
  const wallet = await prisma.externalWallet.findUnique({ where: { id: body.id } });
  if (!wallet) return NextResponse.json({ error: "Wallet not found." }, { status: 404 });

  const delta = points - wallet.cashbackPoints;
  const updated = await prisma.externalWallet.update({
    where: { id: wallet.id },
    data: {
      cashbackPoints: points,
      adminNote: body.note !== undefined ? String(body.note).slice(0, 300) : wallet.adminNote,
      reviewedAt: new Date(),
    },
  });

  // credit the difference to the owner's reward ledger (idempotent per amount)
  if (delta !== 0) {
    await awardPoints(wallet.userId, delta, "ACTIVITY", {
      action: "wallet-cashback",
      wallet: wallet.address,
    });
  }
  await auditLog(res.user.id, "setWalletCashback", "externalWallet", wallet.id, {
    points,
    delta,
  });

  return NextResponse.json({ ok: true, wallet: { id: updated.id, cashbackPoints: updated.cashbackPoints } });
}
