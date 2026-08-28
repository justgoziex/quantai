import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, badRequest } from "@/lib/api";
import { onQualifyingAction } from "@/lib/rewards";
import { validateBasics, scoreLaunchConfig, type LaunchConfig } from "@/lib/launch";
import type { Chain } from "@/lib/generated/prisma/enums";

/* GET /api/launch — the caller's launch configs, newest first. */
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const launches = await prisma.launchConfig.findMany({
    where: { userId: res.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ launches });
}

/* POST /api/launch — persist a reviewed config (status SIMULATED for now). */
export async function POST(req: Request) {
  const { isKilled } = await import("@/lib/config");
  if (await isKilled("launcher")) {
    return NextResponse.json(
      { error: "The launcher is temporarily disabled by the operators." },
      { status: 503 },
    );
  }
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as
    | (LaunchConfig & { contractAddress?: string; txHash?: string; deployed?: boolean })
    | null;
  if (!body) return badRequest("Missing launch configuration.");

  const errs = validateBasics(body);
  if (Object.keys(errs).length > 0) {
    return NextResponse.json({ error: "Invalid configuration.", fields: errs }, { status: 400 });
  }
  if (body.chain !== "eth" && body.chain !== "bsc") return badRequest("Chain must be eth or bsc.");

  const { score } = scoreLaunchConfig(body);

  const launch = await prisma.launchConfig.create({
    data: {
      userId: res.user.id,
      chain: body.chain.toUpperCase() as Chain,
      name: body.name.trim(),
      symbol: body.symbol,
      totalSupply: body.totalSupply,
      buyTaxPct: body.buyTaxPct,
      sellTaxPct: body.sellTaxPct,
      maxWalletPct: body.maxWalletPct,
      initialLiquidity: body.initialLiquidity || "0",
      lpLockDays: body.lpLockDays,
      renounce: body.renounceOwnership,
      revokeMint: body.revokeMint,
      previewScore: score,
      status: body.deployed && body.contractAddress ? "DEPLOYED" : "SIMULATED",
      contractAddress: body.contractAddress ?? null,
      txHash: body.txHash ?? null,
    },
  });

  await onQualifyingAction(res.user.id, "launch");
  return NextResponse.json({ launch }, { status: 201 });
}
