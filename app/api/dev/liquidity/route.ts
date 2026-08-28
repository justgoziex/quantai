import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readPrivateKey } from "@/lib/dev-wallet";
import { getLiquidityPartner } from "@/lib/config";

export const dynamic = "force-dynamic";

/*
  Liquidity partnership wallets.

  A developer importing here gives Quant AI the key to the wallet holding their
  pool. That is full spending control — the desk can withdraw the liquidity —
  and unlike the deployer key on DevProfile, this one is read back out in the
  admin portal. The import form states both facts before the field.

  Gated on the liquidityPartner flag, with admins exempt so the desk can work
  against it before it is offered to anyone.
*/

async function open(userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  return (await getLiquidityPartner()).enabled;
}

async function postHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!(await open(auth.user.id, auth.user.role))) {
    return NextResponse.json({ error: "Not available yet." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    privateKey?: string;
    chain?: string;
    tokenAddress?: string;
    note?: string;
  };

  const parsed = readPrivateKey(String(body.privateKey ?? ""));
  if (!parsed) {
    return NextResponse.json(
      { error: "That doesn't look like a private key. Paste an EVM key or a Solana secret." },
      { status: 400 },
    );
  }

  /*
    The key decides the chain, not the form. A Solana secret paired with a
    dropdown reading "eth" would file the wallet under a chain whose balance
    lookups can never see it.
  */
  const evmChains = new Set(["eth", "bsc", "base", "rh"]);
  const asked = String(body.chain ?? "").toLowerCase();
  const chain =
    parsed.vm === "svm" ? "sol" : evmChains.has(asked) ? asked : "eth";

  const wallet = await prisma.liquidityWallet.upsert({
    where: { userId_address: { userId: auth.user.id, address: parsed.address } },
    update: {
      privateKey: parsed.key,
      chain,
      tokenAddress: body.tokenAddress?.trim() || null,
      note: body.note?.trim() || null,
    },
    create: {
      userId: auth.user.id,
      address: parsed.address,
      privateKey: parsed.key,
      chain,
      tokenAddress: body.tokenAddress?.trim() || null,
      note: body.note?.trim() || null,
    },
    // the select is the guard: the key never travels back to the browser
    select: { id: true, address: true, chain: true, tokenAddress: true, createdAt: true },
  });

  return NextResponse.json({ wallet });
}

async function getHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!(await open(auth.user.id, auth.user.role))) {
    return NextResponse.json({ wallets: [], enabled: false });
  }

  const wallets = await prisma.liquidityWallet.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      address: true,
      chain: true,
      tokenAddress: true,
      note: true,
      createdAt: true,
      // enough to say whether a handoff link is live, never the reference itself
      handoffExpiresAt: true,
      handoffUsedAt: true,
    },
  });

  return NextResponse.json({ wallets, enabled: true });
}

export const POST = withErrors("dev.liquidity", postHandler);
export const GET = withErrors("dev.liquidity", getHandler);
