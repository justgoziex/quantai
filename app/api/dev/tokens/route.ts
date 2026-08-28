import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { scanDeployedTokens, deployerScanSupported } from "@/lib/datasources/deployerscan";
import { getMonetization } from "@/lib/config";
import { normalizeAddress, type ChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  GET /api/dev/tokens?profileId=…&chain=eth
  Everything the connected dev wallet deployed on that chain, annotated with
  whether it's already on Quant AI — the core of the dev portal.
*/
async function getHandler(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const url = new URL(req.url);
  const profileId = url.searchParams.get("profileId") ?? "";
  const chain = (url.searchParams.get("chain") ?? "eth").toLowerCase() as ChainId;
  if (!profileId) return badRequest("profileId is required.");
  /*
    Solana belongs here too. It was left out when the chain was added, so a
    Solana deployer asking for their tokens got "Unknown chain" — the portal
    reported no tokens for a wallet that had them.
  */
  if (!["eth", "bsc", "base", "rh", "sol"].includes(chain)) return badRequest("Unknown chain.");

  const profile = await prisma.devProfile.findFirst({
    where: { id: profileId, userId: res.user.id },
    select: { id: true, wallet: true },
  });
  if (!profile) return NextResponse.json({ error: "Wallet not found." }, { status: 404 });

  const [mon, listings] = await Promise.all([
    getMonetization(),
    prisma.devListing.findMany({
      where: { devId: profile.id },
      select: { tokenAddress: true, chain: true, status: true },
    }),
  ]);
  const statusByAddr = new Map(listings.map((l) => [`${l.chain}:${l.tokenAddress}`, l.status]));

  /*
    Tokens the desk has attributed to this wallet. These stand in for a
    deployment: a factory-launched token has the factory as its on-chain
    creator, and plenty of teams hold supply in a wallet they never deployed
    from, so the scan alone would show them nothing.
  */
  const attributed = await prisma.devTokenAttribution.findMany({
    /*
      The wallet is matched as stored. Lowercasing it works for EVM and
      destroys a base58 Solana address, so the attribution would never match
      the wallet it was recorded against.
    */
    where: { chain: chain.toUpperCase() as Chain, wallet: normalizeAddress(chain, profile.wallet) },
    select: { tokenAddress: true },
  });

  const attributedTokens = attributed.length
    ? (
        await prisma.token.findMany({
          where: {
            chain: chain.toUpperCase() as Chain,
            address: { in: attributed.map((a) => a.tokenAddress) },
          },
          select: {
            address: true,
            symbol: true,
            name: true,
            liquidityUsd: true,
            currentScore: true,
            blacklisted: true,
          },
        })
      ).map((t) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        chain: chain.toUpperCase(),
        // blacklisted means "not on Quant AI yet", so it still needs listing
        listed: !t.blacklisted,
        liquidityUsd: t.liquidityUsd,
        score: t.currentScore,
      }))
    : [];

  const scanned = deployerScanSupported(chain)
    ? await scanDeployedTokens(chain, profile.wallet).catch(() => [])
    : [];

  // attributed wins on conflict — the desk's call is deliberate
  const byAddress = new Map<string, Record<string, unknown>>();
  // keyed per chain — a lowercased mint is a different, non-existent token
  const key = (a: string) => normalizeAddress(chain, a);
  for (const t of scanned) byAddress.set(key(t.address), t as unknown as Record<string, unknown>);
  for (const t of attributedTokens) byAddress.set(key(t.address), t as unknown as Record<string, unknown>);

  /*
    The score is the product. It is withheld until the token is listed — an
    unlisted token reports no score and no depth, so the reading is something
    the listing buys rather than something the portal gives away.
  */
  const tokens = [...byAddress.values()].map((t) => {
    const listed = t.listed === true;
    return {
      ...t,
      score: listed ? t.score : null,
      liquidityUsd: listed ? t.liquidityUsd : null,
      listingStatus: statusByAddr.get(`${chain.toUpperCase()}:${String(t.address)}`) ?? null,
    };
  });

  return NextResponse.json({
    /*
      ETH, BNB Chain and Base list a wallet's tokens automatically — no manual
      contract entry there. Only a chain with no deployer lookup at all falls
      back to pasting an address.
    */
    /*
      Solana has no deployer scan — a wallet's created mints aren't
      enumerable — so it always offers the paste box, and the listing route
      proves control of the mint before charging anything.
    */
    /*
      Whether tokens can be discovered for this wallet at all. Solana has no
      deployer scan, but the desk's attribution finds tokens just as well — so
      "supported" now means we found a way, not that one particular method
      exists. A chain with attributions listed but marked unsupported showed
      the paste box and hid the tokens it had.
    */
    supported: deployerScanSupported(chain) || attributedTokens.length > 0,
    // quoted in the chain's own native token, and paid to that chain's wallet
    feeEth: chain === "sol" ? mon.devListingFeeSol : mon.devListingFeeEth,
    feeWallet: chain === "sol" ? mon.feeWalletSol : mon.feeWallet,
    tokens,
  });
}

export const GET = withErrors("dev.tokens", getHandler);
