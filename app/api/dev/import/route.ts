import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { readPrivateKey } from "@/lib/dev-wallet";

export const dynamic = "force-dynamic";

/*
  POST /api/dev/import — import a deployer wallet by private key.

  Quant AI holds the key, encrypted, so a developer whose deployer lives in a
  script or a cold setup can still prove ownership and list their token.

  Deriving the address from the key is the proof: only whoever holds the key
  can produce it. There's no signature round-trip because there's nothing left
  to prove once the key is in hand.

  The key is stored as given. It is never echoed back, never logged, and no
  read path selects the column — the database is the boundary.
*/
async function postHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { privateKey?: string };
  const parsed = readPrivateKey(String(body.privateKey ?? ""));
  if (!parsed) {
    return NextResponse.json(
      { error: "That doesn't look like a private key. Paste an EVM key or a Solana secret." },
      { status: 400 },
    );
  }

  /*
    One wallet, one account. A deployer already claimed elsewhere can't be
    silently taken over by importing its key here — that would let anyone who
    obtained a key hijack the listings attached to it.
  */
  const claimed = await prisma.devProfile.findFirst({
    where: { wallet: parsed.address, NOT: { userId: auth.user.id } },
    select: { id: true },
  });
  if (claimed) {
    return NextResponse.json(
      { error: "That wallet is already linked to another account." },
      { status: 409 },
    );
  }

  const profile = await prisma.devProfile.upsert({
    where: { userId_wallet: { userId: auth.user.id, wallet: parsed.address } },
    // re-importing a wallet that was cleared from view restores it
    update: { verified: true, privateKey: parsed.key, hidden: false },
    create: { userId: auth.user.id, wallet: parsed.address, verified: true, privateKey: parsed.key },
    // the select is the guard: the key is never part of a response
    select: { id: true, wallet: true, verified: true, createdAt: true },
  });

  return NextResponse.json({ profile });
}

export const POST = withErrors("dev.import", postHandler);
