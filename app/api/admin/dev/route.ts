import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { requireAdmin, auditLog } from "@/lib/admin";

export const dynamic = "force-dynamic";

/*
  Admin view of the developer portal: every dev listing and ad campaign, with
  actions to reject/refund-flag a listing or pause/resume an ad.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const [listings, campaigns, revenue] = await Promise.all([
    prisma.devListing.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { dev: { select: { wallet: true, user: { select: { email: true } } } } },
    }),
    prisma.adCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { dev: { select: { wallet: true } } },
    }),
    Promise.all([
      prisma.devListing.aggregate({ _sum: { feeEth: true }, where: { status: "LISTED" } }),
      prisma.adCampaign.aggregate({ _sum: { feeEth: true }, where: { status: { in: ["ACTIVE", "ENDED"] } } }),
    ]),
  ]);

  const attributions = await prisma.devTokenAttribution.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    attributions,
    listings: listings.map((l) => ({
      id: l.id,
      chain: l.chain,
      tokenAddress: l.tokenAddress,
      symbol: l.symbol,
      status: l.status,
      feeEth: l.feeEth,
      feeTxHash: l.feeTxHash,
      wallet: l.dev?.wallet ?? null,
      email: l.dev?.user?.email ?? null,
      createdAt: l.createdAt,
      listedAt: l.listedAt,
    })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      chain: c.chain,
      tokenAddress: c.tokenAddress,
      symbol: c.symbol,
      headline: c.headline,
      status: c.status,
      days: c.days,
      feeEth: c.feeEth,
      impressions: c.impressions,
      clicks: c.clicks,
      endsAt: c.endsAt,
      wallet: c.dev?.wallet ?? null,
      createdAt: c.createdAt,
    })),
    revenue: {
      listingsEth: revenue[0]._sum.feeEth ?? 0,
      adsEth: revenue[1]._sum.feeEth ?? 0,
    },
  });
}

/* POST { kind: "listing"|"ad", id, action } */
export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    id?: string;
    action?: string;
    note?: string;
    chain?: string;
    tokenAddress?: string;
    wallet?: string;
  } | null;

  /*
    Attribution: hand a token to a wallet that did not deploy it. Needed for
    factory-launched tokens (the factory is the on-chain creator) and for teams
    whose supply wallet is not their deploy wallet.
  */
  if (body?.kind === "attribution") {
    if (body.action === "remove") {
      if (!body.id) return badRequest("id is required.");
      await prisma.devTokenAttribution.delete({ where: { id: body.id } }).catch(() => {});
      await auditLog(res.user.id, "dev.attribution.remove", "DevTokenAttribution", body.id);
      return NextResponse.json({ ok: true });
    }

    const chain = String(body.chain ?? "").toUpperCase();
    if (!["ETH", "BSC", "BASE", "RH", "SOL"].includes(chain)) return badRequest("Unknown chain.");

    /*
      Normalise per chain, and validate per chain.

      Both fields were lowercased and matched against a hex pattern, so a
      Solana mint or wallet was rejected as invalid — the desk simply could not
      attribute a Solana token to its developer through this screen.
    */
    const isSol = chain === "SOL";
    const rawToken = String(body.tokenAddress ?? "").trim();
    const rawWallet = String(body.wallet ?? "").trim();
    const tokenAddress = isSol ? rawToken : rawToken.toLowerCase();
    const wallet = isSol ? rawWallet : rawWallet.toLowerCase();

    const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const hex = /^0x[0-9a-f]{40}$/;
    if (!(isSol ? base58.test(tokenAddress) : hex.test(tokenAddress))) {
      return badRequest("Enter a valid token address.");
    }
    if (!(isSol ? base58.test(wallet) : hex.test(wallet))) {
      return badRequest("Enter a valid wallet address.");
    }

    const row = await prisma.devTokenAttribution.upsert({
      where: { chain_tokenAddress: { chain: chain as never, tokenAddress } },
      update: { wallet, note: body.note?.slice(0, 200) ?? null, createdBy: res.user.id },
      create: {
        chain: chain as never,
        tokenAddress,
        wallet,
        note: body.note?.slice(0, 200) ?? null,
        createdBy: res.user.id,
      },
    });
    await auditLog(res.user.id, "dev.attribution.set", "DevTokenAttribution", row.id, {
      chain,
      tokenAddress,
      wallet,
    });
    return NextResponse.json({ ok: true, attribution: row });
  }

  if (!body?.id || !body.action) return badRequest("id and action are required.");

  if (body.kind === "listing") {
    const listing = await prisma.devListing.findUnique({ where: { id: body.id } });
    if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (body.action === "reject") {
      await prisma.devListing.update({
        where: { id: listing.id },
        data: { status: "REJECTED", adminNote: body.note?.slice(0, 200) ?? null },
      });
      if (listing.tokenId) {
        await prisma.token.update({ where: { id: listing.tokenId }, data: { devListed: false } }).catch(() => {});
      }
    } else if (body.action === "approve") {
      await prisma.devListing.update({ where: { id: listing.id }, data: { status: "LISTED", listedAt: new Date() } });
      if (listing.tokenId) {
        await prisma.token.update({ where: { id: listing.tokenId }, data: { devListed: true } }).catch(() => {});
      }
    }
    await auditLog(res.user.id, `devListing.${body.action}`, "DevListing", listing.id, {
      token: listing.tokenAddress,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.kind === "ad") {
    const ad = await prisma.adCampaign.findUnique({ where: { id: body.id } });
    if (!ad) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    const status = body.action === "pause" ? "ENDED" : body.action === "resume" ? "ACTIVE" : body.action === "reject" ? "REJECTED" : ad.status;
    await prisma.adCampaign.update({
      where: { id: ad.id },
      data: { status, adminNote: body.note?.slice(0, 200) ?? null },
    });
    await auditLog(res.user.id, `adCampaign.${body.action}`, "AdCampaign", ad.id, { token: ad.tokenAddress });
    return NextResponse.json({ ok: true });
  }

  return badRequest("Unknown kind.");
}
