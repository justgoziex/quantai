import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { isSolAddress } from "@/lib/solana";
import { buildLaunchTransaction } from "@/lib/solana-launch";
import { getSiteUrl } from "@/lib/site";
import { sanitizeText } from "@/lib/text-safety";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/*
  POST /api/launch/solana — prepare a token launch for the developer to sign.

  The transaction is assembled here and signed in their wallet: they pay the
  rent, they own the supply, and nothing is custodial at any point. The launch
  record is written first so the metadata URL resolves the instant the mint
  lands — a wallet that looks it up a second later must find a name, not a 404.
*/
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    owner?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    totalSupply?: string;
    logoUrl?: string;
    description?: string;
    revokeAuthorities?: boolean;
  };

  const owner = String(body.owner ?? "");
  if (!isSolAddress(owner)) {
    return NextResponse.json({ error: "Connect a Solana wallet to launch." }, { status: 400 });
  }

  const name = sanitizeText(String(body.name ?? ""), 32);
  const symbol = sanitizeText(String(body.symbol ?? ""), 10).toUpperCase();
  if (!name || !symbol) {
    return NextResponse.json({ error: "A name and symbol are required." }, { status: 400 });
  }

  const decimals = Math.min(9, Math.max(0, Math.floor(Number(body.decimals ?? 9))));
  const supplyRaw = Number(body.totalSupply ?? 0);
  if (!Number.isFinite(supplyRaw) || supplyRaw <= 0) {
    return NextResponse.json({ error: "Enter a total supply." }, { status: 400 });
  }
  /*
    Supply is held as a bigint in the token's own units. Going through a float
    would quietly round a large supply, and a token minted with a different
    number than the developer typed is not a token they asked for.
  */
  const totalSupply = BigInt(Math.floor(supplyRaw)) * BigInt(10) ** BigInt(decimals);

  const logoUrl = String(body.logoUrl ?? "").trim();
  if (logoUrl && !/^https:\/\/\S+$/i.test(logoUrl)) {
    return NextResponse.json({ error: "The image link must start with https://" }, { status: 400 });
  }

  // reserve the record first so the metadata URL resolves immediately
  const launch = await prisma.launchConfig.create({
    data: {
      userId: auth.user.id,
      chain: "SOL",
      name,
      symbol,
      totalSupply: String(supplyRaw),
      logoUrl: logoUrl || null,
      description: sanitizeText(String(body.description ?? ""), 300) || null,
      revokeMint: Boolean(body.revokeAuthorities),
      renounce: Boolean(body.revokeAuthorities),
      status: "DRAFT",
    },
    select: { id: true },
  });

  const plan = await buildLaunchTransaction({
    owner,
    name,
    symbol,
    decimals,
    totalSupply,
    metadataUri: "",
    revokeAuthorities: Boolean(body.revokeAuthorities),
  }).catch(() => ({ error: "Couldn't prepare the launch." }) as const);

  if ("error" in plan) {
    await prisma.launchConfig.delete({ where: { id: launch.id } }).catch(() => {});
    return NextResponse.json({ error: plan.error }, { status: 400 });
  }

  /*
    The metadata URL contains the mint, which only exists once the transaction
    is built — so the record is updated with it now, and the transaction is
    rebuilt with the finished URL.
  */
  const metadataUri = `${getSiteUrl()}/api/token-metadata/${plan.mint}`;
  const final = await buildLaunchTransaction({
    owner,
    name,
    symbol,
    decimals,
    totalSupply,
    metadataUri,
    revokeAuthorities: Boolean(body.revokeAuthorities),
  });
  if ("error" in final) {
    await prisma.launchConfig.delete({ where: { id: launch.id } }).catch(() => {});
    return NextResponse.json({ error: final.error }, { status: 400 });
  }

  await prisma.launchConfig.update({
    where: { id: launch.id },
    data: { contractAddress: final.mint },
  });

  return NextResponse.json({
    launchId: launch.id,
    mint: final.mint,
    transaction: final.transaction,
    estimatedCostSol: final.estimatedCostSol,
  });
}
