import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { getMonetization } from "@/lib/config";
import { verifyFeePayment } from "@/lib/fee-payment";
import { upsertScoredToken } from "@/lib/ingest";
import { fetchTokenSecurity, fetchSolanaSecurity } from "@/lib/datasources/goplus";
import { CHAINS, normalizeAddress, type ChainId, type EvmChainId } from "@/lib/chains";
import { isSolAddress, solControlsMint, verifySolFeePayment } from "@/lib/solana";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GT = "https://api.geckoterminal.com/api/v2";
const GT_NET: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/*
  Dev token listings.
  GET  → the caller's listings
  POST → { profileId, chain as EvmChainId, tokenAddress, feeTxHash } — verify the listing fee
         on-chain as EvmChainId, then ingest + score the token so it appears in the screener
         immediately, flagged as developer-listed.
*/
async function getHandler(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const listings = await prisma.devListing.findMany({
    where: { dev: { userId: res.user.id } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ listings });
}

async function postHandler(req: Request) {
  try {
    return await handleListing(req);
  } catch (e) {
    // never let the function die with an empty body — the client would only
    // see the browser's generic "data couldn't be read" message
    console.error("dev listing failed:", (e as Error).message);
    return NextResponse.json(
      { error: `Listing failed: ${(e as Error).message?.slice(0, 160) ?? "unknown error"}` },
      { status: 500 },
    );
  }
}

async function handleListing(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    profileId?: string;
    chain?: string;
    tokenAddress?: string;
    feeTxHash?: string;
  } | null;
  if (!body?.profileId || !body.tokenAddress) return badRequest("Missing listing details.");

  const chain = String(body.chain ?? "eth").toLowerCase() as ChainId;
  if (!CHAINS[chain]) return badRequest("Unknown chain.");
  // base58 mints keep their case; EVM contracts are lowered as before
  const rawToken = String(body.tokenAddress).trim();
  const isSol = chain === "sol";
  const tokenAddress = isSol ? rawToken : rawToken.toLowerCase();
  if (isSol ? !isSolAddress(tokenAddress) : !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return badRequest("Enter a valid contract address.");
  }

  const profile = await prisma.devProfile.findFirst({
    where: { id: body.profileId, userId: res.user.id },
    select: { id: true, wallet: true },
  });
  if (!profile) return NextResponse.json({ error: "Dev wallet not found." }, { status: 404 });

  /*
    Solana has no deployer scan to lean on, so ownership is proved per mint:
    the connected wallet must be the mint, freeze or update authority, or a
    listed creator. A desk attribution stands in when a team's supply wallet
    isn't the authority.
  */
  if (isSol) {
    const attributed = await prisma.devTokenAttribution.findFirst({
      where: { chain: "SOL", tokenAddress, wallet: profile.wallet },
      select: { id: true },
    });
    if (!attributed && !(await solControlsMint(profile.wallet, tokenAddress))) {
      return NextResponse.json(
        { error: "This wallet isn't the mint, freeze or update authority for that token." },
        { status: 403 },
      );
    }
  }

  /*
    Already listed on the platform? Then there's nothing to pay for.

    A blacklisted row is deliberately NOT excluded from listing — blacklisted
    means "not on Quant AI yet", and the token's verified developer can list it,
    which clears the flag further down. It's excluded here so the fee still
    applies (it isn't an existing listing).
  */
  const chainEnum = chain.toUpperCase() as Chain;
  const existingToken = await prisma.token.findFirst({
    where: { chain: chainEnum, address: tokenAddress, blacklisted: false },
    select: { id: true },
  });

  const mon = await getMonetization();
  // the fee is denominated in each chain's own native token — a SOL listing is
  // priced in SOL, and quoting it in ETH would be a different amount entirely
  const feeEth = isSol ? mon.devListingFeeSol : mon.devListingFeeEth;

  // A previous attempt may have paid already (payment succeeded but listing
  // failed) — never charge twice for the same token.
  const priorPaid = await prisma.devListing.findFirst({
    where: { chain: chainEnum, tokenAddress, devId: profile.id, feeTxHash: { not: null } },
    select: { id: true, feeTxHash: true },
  });

  const txHash = String(body.feeTxHash ?? "").trim();
  const needsPayment = !existingToken && feeEth > 0 && !priorPaid;

  if (needsPayment) {
    // 402 tells the client "a fee is due" so it can prompt the wallet — the
    // server is the only thing that decides whether payment is required.
    if (!txHash) {
      return NextResponse.json(
        { error: "The listing fee payment is required.", needsPayment: true, feeEth },
        { status: 402 },
      );
    }
    const used = await prisma.devListing.findFirst({ where: { feeTxHash: txHash } });
    if (used) return badRequest("That payment was already used for another listing.");
    const check = isSol
      ? await verifySolFeePayment(txHash, feeEth, mon.feeWalletSol, mon.feeTolerancePct)
      : await verifyFeePayment(chain as EvmChainId, txHash, feeEth);
    if (!check.ok) {
      return NextResponse.json({ error: check.error, pending: check.pending ?? false }, { status: check.pending ? 202 : 400 });
    }
    // record the payment IMMEDIATELY so a later failure can't cost them twice
    await prisma.devListing.upsert({
      where: { chain_tokenAddress: { chain: chainEnum, tokenAddress } },
      update: { devId: profile.id, status: "PAID", feeEth, feeTxHash: txHash },
      create: { devId: profile.id, chain: chainEnum, tokenAddress, status: "PAID", feeEth, feeTxHash: txHash },
    });
  }

  // the payment on record (this attempt's, or one from a failed attempt)
  const paidTxHash = txHash || priorPaid?.feeTxHash || null;

  // ingest + score the token so it shows up in the screener right away
  let tokenId = existingToken?.id ?? null;
  let symbol: string | null = null;
  let name: string | null = null;
  if (!tokenId) {
    const pool = await topPoolFor(chain, tokenAddress);
    if (!pool) {
      return NextResponse.json(
        {
          error:
            "We couldn't find a liquidity pool for that token on this chain. Add liquidity first, then list — your payment is on record and won't be charged again.",
        },
        { status: 400 },
      );
    }
    const sec = CHAINS[chain].securitySupported
      ? await (isSol
          ? fetchSolanaSecurity([tokenAddress])
          : fetchTokenSecurity(chain as EvmChainId, [tokenAddress])
        )
          .then((m) => m.get(tokenAddress))
          .catch(() => undefined)
      : undefined;
    try {
      // the chain is passed as itself — casting Solana to an EVM id here is
      // what made a Solana listing fail with a 500 instead of listing
      await upsertScoredToken(chain, pool, sec, "trending");
    } catch (e) {
      return NextResponse.json(
        { error: `Couldn't score that token: ${(e as Error).message?.slice(0, 120)}` },
        { status: 500 },
      );
    }
    // unfiltered: a previously-blacklisted row is valid here, and the update
    // below is what actually clears the flag
    const row = await prisma.token.findFirst({
      where: { chain: chainEnum, address: tokenAddress },
      select: { id: true, symbol: true, name: true },
    });
    tokenId = row?.id ?? null;
    symbol = row?.symbol ?? null;
    name = row?.name ?? null;
  }

  if (!tokenId) {
    return NextResponse.json(
      { error: "That token couldn't be indexed — it may not have a tradeable pool yet. Your payment is on record." },
      { status: 400 },
    );
  }

  /*
    Listing succeeded: mark it dev-listed and lift the not-listed flag. This is
    the last step, so a token whose pool lookup or scoring failed above stays
    unlisted rather than going live half-indexed.
  */
  await prisma.token
    .update({
      where: { id: tokenId },
      data: { devListed: true, blacklisted: false, blacklistReason: null },
    })
    .catch(() => {});

  const listing = await prisma.devListing.upsert({
    where: { chain_tokenAddress: { chain: chainEnum, tokenAddress } },
    update: {
      devId: profile.id,
      status: "LISTED",
      feeEth: existingToken ? 0 : feeEth,
      ...(paidTxHash ? { feeTxHash: paidTxHash } : {}),
      tokenId,
      listedAt: new Date(),
    },
    create: {
      devId: profile.id,
      chain: chainEnum,
      tokenAddress,
      symbol,
      name,
      status: "LISTED",
      feeEth: existingToken ? 0 : feeEth,
      feeTxHash: paidTxHash,
      tokenId,
      listedAt: new Date(),
    },
  });

  return NextResponse.json({ listing, alreadyIndexed: Boolean(existingToken) }, { status: 201 });
}

/* Top pool for a token, so a fresh listing can be scored immediately. */
async function topPoolFor(chain: ChainId, address: string) {
  try {
    const r = await fetch(`${GT}/networks/${GT_NET[chain]}/tokens/${address}/pools?page=1`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const p = (await r.json().catch(() => null))?.data?.[0];
    const a = p?.attributes;
    if (!a) return null;
    return {
      // base58 pool addresses carry case; only hex is safe to lowercase
      poolAddress: normalizeAddress(chain, String(a.address ?? "")),
      tokenAddress: address,
      name: String(a.name ?? ""),
      dex: String(p.relationships?.dex?.data?.id ?? "").replace(/_/g, " "),
      priceUsd: num(a.base_token_price_usd),
      liquidityUsd: num(a.reserve_in_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      fdvUsd: num(a.fdv_usd),
      buys1h: num(a.transactions?.h1?.buys),
      sells1h: num(a.transactions?.h1?.sells),
      buys24h: num(a.transactions?.h24?.buys),
      sells24h: num(a.transactions?.h24?.sells),
      priceChange1h: num(a.price_change_percentage?.h1),
      priceChange6h: num(a.price_change_percentage?.h6),
      priceChange24h: num(a.price_change_percentage?.h24),
      volume1hUsd: num(a.volume_usd?.h1),
    buys5m: num(a.transactions?.m5?.buys),
    sells5m: num(a.transactions?.m5?.sells),
    priceChange5m: num(a.price_change_percentage?.m5),
    volume5mUsd: num(a.volume_usd?.m5),
      createdAt: String(a.pool_created_at ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

export const GET = withErrors("dev.listing", getHandler);

export const POST = withErrors("dev.listing", postHandler);
