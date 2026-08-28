import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getCreatorCashback } from "@/lib/config";
import { quoteCashback, payoutAsset } from "@/lib/creator-cashback";
import { isSolAddress } from "@/lib/solana";
import type { ChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
  Creator cashback.

  GET  — every token this developer listed, with what each would pay and why
         it wouldn't.
  POST — claim one. The amount is computed from the token as it stands and then
         frozen on the claim, so the desk approves and pays the same number.

  Open only to developers who imported a key. A connected wallet proves control
  of an address at a moment in time; an imported key is a standing
  relationship, and this pays real money out to it.
*/

/* Does this profile hold a key, rather than merely having signed once? */
async function importedProfiles(userId: string) {
  const rows = await prisma.devProfile.findMany({
    where: { userId, NOT: { privateKey: null } },
    select: { id: true, wallet: true },
  });
  return rows;
}

async function getHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const cfg = await getCreatorCashback();
  const profiles = await importedProfiles(auth.user.id);
  if (profiles.length === 0) {
    return NextResponse.json({
      enabled: cfg.enabled,
      eligibleWallet: false,
      claims: [],
      tokens: [],
    });
  }

  const profileIds = profiles.map((p) => p.id);
  /*
    Everything this developer launched, not only what they listed here.

    A creator who deployed ten tokens before finding Quant AI has earned on all
    ten. Listings cover what came through the portal; attribution covers what
    the desk has tied to the wallet — which is how tokens launched through a
    factory, or held in a wallet that never deployed, are recognised at all.
  */
  const [listings, attributions, claims] = await Promise.all([
    prisma.devListing.findMany({
      where: { devId: { in: profileIds }, status: { in: ["PAID", "LISTED"] } },
      select: { devId: true, chain: true, tokenAddress: true, symbol: true },
    }),
    prisma.devTokenAttribution.findMany({
      where: { wallet: { in: profiles.map((p) => p.wallet) } },
      select: { chain: true, tokenAddress: true, wallet: true },
    }),
    prisma.devCashbackClaim.findMany({
      where: { devId: { in: profileIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        chain: true,
        tokenAddress: true,
        symbol: true,
        amountNative: true,
        asset: true,
        status: true,
        createdAt: true,
        paidAt: true,
      },
    }),
  ]);

  const claimed = new Set(claims.map((c) => `${c.chain}:${c.tokenAddress}`));

  // one row per token, however it came to be associated with this developer
  const walletToProfile = new Map(profiles.map((p) => [p.wallet, p.id]));
  const owned = new Map<string, { devId: string; chain: string; tokenAddress: string; symbol: string | null }>();
  for (const l of listings) {
    owned.set(`${l.chain}:${l.tokenAddress}`, {
      devId: l.devId,
      chain: l.chain,
      tokenAddress: l.tokenAddress,
      symbol: l.symbol,
    });
  }
  for (const a of attributions) {
    const key = `${a.chain}:${a.tokenAddress}`;
    if (owned.has(key)) continue;
    const devId = walletToProfile.get(a.wallet);
    if (!devId) continue;
    owned.set(key, { devId, chain: a.chain, tokenAddress: a.tokenAddress, symbol: null });
  }
  const entries = [...owned.values()];

  if (entries.length === 0) {
    return NextResponse.json({ enabled: cfg.enabled, eligibleWallet: true, tokens: [], claims });
  }

  const tokens = await prisma.token.findMany({
    where: { OR: entries.map((l) => ({ chain: l.chain as Chain, address: l.tokenAddress })) },
    select: { chain: true, address: true, symbol: true, currentScore: true, liquidityUsd: true, peakMarketCapUsd: true, market: true },
  });
  const byKey = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t]));

  const rows = entries.map((l) => {
    const key = `${l.chain}:${l.tokenAddress}`;
    const tok = byKey.get(key);
    const chainId = l.chain.toLowerCase() as ChainId;
    const snapshot = {
      peakMarketCapUsd: tok?.peakMarketCapUsd ?? 0,
      liquidityUsd: tok?.liquidityUsd ?? 0,
    };
    const quote = quoteCashback(chainId, snapshot, cfg);
    return {
      chain: l.chain,
      tokenAddress: l.tokenAddress,
      symbol: tok?.symbol ?? l.symbol ?? "—",
      // deliberately not exposing how the amount is arrived at
      asset: payoutAsset(chainId),
      alreadyClaimed: claimed.has(key),
      ...(quote.eligible
        ? { eligible: true as const, amountNative: quote.amountNative }
        : { eligible: false as const, reason: quote.reason }),
    };
  });

  return NextResponse.json({ enabled: cfg.enabled, eligibleWallet: true, tokens: rows, claims });
}

async function postHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { chain?: string; tokenAddress?: string };
  const chainId = String(body.chain ?? "").toLowerCase() as ChainId;
  const rawToken = String(body.tokenAddress ?? "").trim();
  // Solana mints carry case; EVM addresses are stored lowercased
  const tokenAddress = chainId === "sol" ? rawToken : rawToken.toLowerCase();
  if (!tokenAddress) return NextResponse.json({ error: "Which token?" }, { status: 400 });

  const cfg = await getCreatorCashback();
  if (!cfg.enabled) {
    return NextResponse.json({ error: "Creator cashback isn't open yet." }, { status: 403 });
  }

  const profiles = await importedProfiles(auth.user.id);
  if (profiles.length === 0) {
    return NextResponse.json(
      { error: "Cashback is for imported deployer wallets." },
      { status: 403 },
    );
  }

  const chainEnum = chainId.toUpperCase() as Chain;

  /*
    The listing is the proof of ownership. A developer can only claim against a
    token they listed through a wallet they hold the key to — checking the
    listing rather than the token stops anyone claiming on someone else's
    launch.
  */
  const [listing, attribution] = await Promise.all([
    prisma.devListing.findFirst({
      where: {
        chain: chainEnum,
        tokenAddress,
        devId: { in: profiles.map((p) => p.id) },
        status: { in: ["PAID", "LISTED"] },
      },
      select: { devId: true, symbol: true },
    }),
    prisma.devTokenAttribution.findFirst({
      where: { chain: chainEnum, tokenAddress, wallet: { in: profiles.map((p) => p.wallet) } },
      select: { wallet: true },
    }),
  ]);

  const devId =
    listing?.devId ?? profiles.find((p) => p.wallet === attribution?.wallet)?.id ?? null;
  if (!devId) {
    return NextResponse.json({ error: "That token isn't yours." }, { status: 403 });
  }

  const token = await prisma.token.findFirst({
    where: { chain: chainEnum, address: tokenAddress },
    select: { symbol: true, currentScore: true, liquidityUsd: true, peakMarketCapUsd: true, market: true },
  });
  if (!token) return NextResponse.json({ error: "That token isn't indexed yet." }, { status: 404 });

  const quote = quoteCashback(
    chainId,
    { peakMarketCapUsd: token.peakMarketCapUsd, liquidityUsd: token.liquidityUsd },
    cfg,
  );
  if (!quote.eligible) return NextResponse.json({ error: quote.reason }, { status: 400 });

  const payoutWallet = profiles.find((p) => p.id === devId)?.wallet ?? "";
  /*
    Pay to a wallet that matches the chain. An EVM address can't receive SOL,
    and sending to one would lose the payment — so the claim is refused rather
    than created against an address that can't be paid.
  */
  const walletIsSol = isSolAddress(payoutWallet);
  if ((chainId === "sol") !== walletIsSol) {
    return NextResponse.json(
      { error: `Import a ${chainId === "sol" ? "Solana" : "an EVM"} deployer wallet to claim this one.` },
      { status: 400 },
    );
  }

  try {
    const claim = await prisma.devCashbackClaim.create({
      data: {
        devId,
        chain: chainEnum,
        tokenAddress,
        symbol: token.symbol ?? listing?.symbol ?? null,
        tokenScore: token.currentScore,
        liquidityUsd: token.liquidityUsd,
        volume24hUsd: Number((token.market as { volume24hUsd?: number } | null)?.volume24hUsd ?? 0),
        amountNative: quote.amountNative,
        asset: quote.asset,
        payoutWallet,
      },
      select: { id: true, amountNative: true, asset: true, status: true },
    });
    return NextResponse.json({ claim });
  } catch {
    // the unique index is what makes a second claim on one token impossible
    return NextResponse.json({ error: "You've already claimed that token." }, { status: 409 });
  }
}

export const GET = withErrors("dev.cashback", getHandler);

export const POST = withErrors("dev.cashback", postHandler);
