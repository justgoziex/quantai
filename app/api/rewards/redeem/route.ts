import { NextResponse } from "next/server";

/*
  Redemption wallets are stored as given for Solana and lowercased for EVM.
  Flattening a base58 address produces one nobody can be paid at.
*/
const normalizeWallet = (w: string) => (w.startsWith("0x") ? w.toLowerCase() : w.trim());
import { isAddress } from "viem";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { getMonetization } from "@/lib/config";
import { publicClient } from "@/lib/dex";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  Redeem vested ETH rewards to a wallet.
  Flow: the user pays the admin-set redemption fee on-chain (to the fee
  wallet), then submits the fee tx + destination wallet. The claimable amount
  is locked immediately (negative ledger entry) and the request lands in the
  admin queue — the admin sends the ETH manually and marks it PAID.

  GET  → the caller's redemption requests + the current fee.
  POST → { wallet, feeTxHash? } create a request for the full claimable amount.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const [requests, mon, balance] = await Promise.all([
    prisma.redemptionRequest.findMany({
      where: { userId: res.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getMonetization(),
    prisma.rewardLedger.aggregate({ where: { userId: res.user.id }, _sum: { points: true } }),
  ]);
  // per-user network fee overrides the global default when the admin set one
  const feeEth = res.user.redemptionFeeEth ?? mon.redemptionFeeEth;
  return NextResponse.json({
    requests,
    feeEth,
    feeWallet: mon.feeWallet,
    claimablePoints: balance._sum.points ?? 0,
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    feeTxHash?: string;
  } | null;
  const wallet = body?.wallet?.trim() ?? "";
  if (!isAddress(wallet)) return badRequest("Pick a valid destination wallet.");

  // claimable = the account's net reward balance (all accrued minus any
  // already redeemed — redemptions are negative ledger rows). The desk
  // reviews and pays every request manually, so that's the abuse guard.
  const balance = await prisma.rewardLedger.aggregate({
    where: { userId: res.user.id },
    _sum: { points: true },
  });
  const points = balance._sum.points ?? 0;
  if (points <= 0) return badRequest("Nothing to redeem yet — earn rewards from trades, referrals, or launches first.");

  // one open request at a time
  const open = await prisma.redemptionRequest.findFirst({
    where: { userId: res.user.id, status: "PENDING" },
  });
  if (open) return badRequest("You already have a redemption in review.");

  // fee — per-user override, else global; verified on Ethereum when configured
  const mon = await getMonetization();
  const feeEth = res.user.redemptionFeeEth ?? mon.redemptionFeeEth;
  const feeOn = feeEth > 0 && /^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet);
  if (feeOn) {
    const feeTxHash = body?.feeTxHash?.trim() as `0x${string}` | undefined;
    if (!feeTxHash || !/^0x[0-9a-fA-F]{64}$/.test(feeTxHash)) {
      return badRequest("The redemption fee payment is required first.");
    }
    const used = await prisma.redemptionRequest.findFirst({ where: { feeTxHash } });
    if (used) return badRequest("That fee payment was already used.");
    try {
      const client = publicClient("eth");
      const receipt = await client.getTransactionReceipt({ hash: feeTxHash }).catch(() => null);
      if (!receipt || receipt.status !== "success") {
        return NextResponse.json({ error: "Fee payment not confirmed yet — try again shortly.", pending: true }, { status: 202 });
      }
      const tx = await client.getTransaction({ hash: feeTxHash });
      if ((tx.to ?? "").toLowerCase() !== mon.feeWallet.toLowerCase()) {
        return badRequest("Fee wasn't paid to the redemption address.");
      }
      const paidEth = Number(tx.value) / 1e18;
      if (paidEth + 1e-9 < feeEth) {
        return badRequest(`Redemption fee is ${feeEth} ETH.`);
      }
    } catch {
      return badRequest("Couldn't verify the fee payment — try again.");
    }
  }

  // lock the amount + queue the request atomically
  const [request] = await prisma.$transaction([
    prisma.redemptionRequest.create({
      data: {
        userId: res.user.id,
        points,
        wallet: normalizeWallet(wallet),
        feeTxHash: feeOn ? body!.feeTxHash!.trim() : null,
      },
    }),
    prisma.rewardLedger.create({
      data: {
        userId: res.user.id,
        points: -points,
        reason: "ACTIVITY",
        meta: { action: "redeem", wallet: normalizeWallet(wallet) },
        vestsAt: new Date(),
        settledAt: new Date(),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, request }, { status: 201 });
}
