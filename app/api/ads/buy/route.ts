import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { getMonetization } from "@/lib/config";
import { verifyFeePayment } from "@/lib/fee-payment";
import { normalizeAddress, CHAINS, type ChainId, type EvmChainId } from "@/lib/chains";
import { isSolAddress } from "@/lib/solana";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  Ad slots.
  GET  → pricing + the caller's campaigns
  POST → { chain as EvmChainId, tokenAddress, symbol, days, headline?, ctaUrl?, feeTxHash }
         verify payment on-chain as EvmChainId, then activate the campaign immediately.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const [mon, campaigns] = await Promise.all([
    getMonetization(),
    prisma.adCampaign.findMany({
      where: { dev: { userId: res.user.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return NextResponse.json({
    pricePerDayEth: mon.adFeePerDayEth,
    feeWallet: mon.feeWallet,
    slots: mon.adSlots,
    campaigns,
  });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    profileId?: string;
    chain?: string;
    tokenAddress?: string;
    symbol?: string;
    days?: number;
    headline?: string;
    ctaUrl?: string;
    feeTxHash?: string;
  } | null;
  if (!body?.tokenAddress) return badRequest("Pick a token to advertise.");

  const chain = String(body.chain ?? "eth").toLowerCase() as ChainId;
  if (!CHAINS[chain]) return badRequest("Unknown chain.");
  // a base58 mint must keep its case, or it matches no token at all
  const tokenAddress = normalizeAddress(
    String(body.chain ?? "eth").toLowerCase() as ChainId,
    String(body.tokenAddress),
  );
  if (chain === "sol" ? !isSolAddress(tokenAddress) : !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) return badRequest("Enter a valid contract address.");
  const days = Math.max(1, Math.min(Math.round(Number(body.days ?? 1)), 30));

  const mon = await getMonetization();
  const feeEth = mon.adFeePerDayEth * days;

  if (feeEth > 0) {
    const txHash = String(body.feeTxHash ?? "").trim();
    if (!txHash) return badRequest("The ad payment is required.");
    const used = await prisma.adCampaign.findFirst({ where: { feeTxHash: txHash } });
    if (used) return badRequest("That payment was already used for another campaign.");
    const check = await verifyFeePayment(chain as EvmChainId, txHash, feeEth);
    if (!check.ok) {
      return NextResponse.json({ error: check.error, pending: check.pending ?? false }, { status: check.pending ? 202 : 400 });
    }
  }

  // link to the caller's dev profile when they have one
  const profile = body.profileId
    ? await prisma.devProfile.findFirst({ where: { id: body.profileId, userId: res.user.id }, select: { id: true } })
    : await prisma.devProfile.findFirst({ where: { userId: res.user.id }, select: { id: true } });

  const bannedToken = await prisma.token.findFirst({
    where: { chain: chain.toUpperCase() as Chain, address: tokenAddress, blacklisted: true },
    select: { id: true },
  });
  if (bannedToken) {
    return NextResponse.json({ error: "This token isn't eligible for promotion." }, { status: 403 });
  }
  const token = await prisma.token.findFirst({
    where: { chain: chain.toUpperCase() as Chain, address: tokenAddress, blacklisted: false },
    select: { symbol: true },
  });

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + days * 86_400_000);
  const campaign = await prisma.adCampaign.create({
    data: {
      devId: profile?.id ?? null,
      chain: chain.toUpperCase() as Chain,
      tokenAddress,
      symbol: (token?.symbol ?? String(body.symbol ?? "?")).slice(0, 12),
      headline: body.headline ? String(body.headline).slice(0, 80) : null,
      ctaUrl: body.ctaUrl ? String(body.ctaUrl).slice(0, 200) : null,
      days,
      feeEth,
      feeTxHash: body.feeTxHash?.trim() || null,
      status: "ACTIVE",
      startsAt,
      endsAt,
    },
  });
  return NextResponse.json({ campaign }, { status: 201 });
}
