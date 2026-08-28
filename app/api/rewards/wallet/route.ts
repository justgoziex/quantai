import { NextResponse } from "next/server";
import { verifyMessage, isAddress } from "viem";
import { isSolAddress, verifySolSignature } from "@/lib/solana";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";
import { fetchWalletActivity } from "@/lib/datasources/walletscan";

/*
  GET  /api/rewards/wallet — the caller's connected external trading wallets.
  POST /api/rewards/wallet — connect one, proven by a signature. The user signs
       a message with the wallet they've traded memecoins from; we verify it on
       chain-agnostic personal_sign and record it for admin review + cashback.
*/
export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const wallets = await prisma.externalWallet.findMany({
    where: { userId: res.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      address: true,
      chain: true,
      verified: true,
      cashbackPoints: true,
      activity: true,
      adminNote: true,
      reviewedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ wallets });
}

export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    message?: string;
    signature?: string;
    chain?: string;
  } | null;
  if (!body) return badRequest("Missing payload.");

  /*
    Solana addresses are base58 and carry case, so only the EVM ones are
    lowercased. Lowercasing a mint or a wallet on Solana produces a string that
    matches nothing and would fail every check below for the wrong reason.
  */
  const isSol = body.chain === "SOL";
  const raw = String(body.address ?? "").trim();
  const address = isSol ? raw : raw.toLowerCase();
  const message = String(body.message ?? "");
  const signature = String(body.signature ?? "");
  const chain = isSol ? "SOL" : body.chain === "BSC" ? "BSC" : "ETH";

  if (isSol ? !isSolAddress(address) : !isAddress(address)) {
    return badRequest("Enter a valid wallet address.");
  }
  if (!message || !signature) return badRequest("A wallet signature is required to prove ownership.");
  // the signed message must bind this exact address (prevents pasting a random one)
  if (!message.toLowerCase().includes(`link wallet ${address.toLowerCase()}`)) {
    return badRequest("Signature message doesn't match this wallet.");
  }

  let ok = false;
  try {
    // Solana signs ed25519 over the raw bytes — no EIP-191 prefix, no recovery
    ok = isSol
      ? await verifySolSignature(message, signature, address)
      : await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
  } catch {
    ok = false;
  }
  if (!ok) return badRequest("Signature doesn't match that wallet — try connecting again.");

  // one wallet can only be linked to one account
  const claimedElsewhere = await prisma.externalWallet.findFirst({
    where: { address, verified: true, NOT: { userId: res.user.id } },
    select: { id: true },
  });
  if (claimedElsewhere) {
    return NextResponse.json(
      { error: "This wallet is already linked to another account." },
      { status: 409 },
    );
  }

  // scan the wallet's on-chain history — which tokens it traded / still holds.
  // Bounded + best-effort: connect never fails because a scanner was slow.
  const activity = isSol ? null : await fetchWalletActivity(address).catch(() => null);

  const wallet = await prisma.externalWallet.upsert({
    where: { userId_address: { userId: res.user.id, address } },
    update: { verified: true, chain, ...(activity ? { activity: activity as never } : {}) },
    create: {
      userId: res.user.id,
      address,
      chain,
      verified: true,
      ...(activity ? { activity: activity as never } : {}),
    },
    select: {
      id: true,
      address: true,
      chain: true,
      verified: true,
      cashbackPoints: true,
      activity: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ wallet }, { status: 201 });
}

/* DELETE /api/rewards/wallet { id } — disconnect one of the caller's wallets. */
export async function DELETE(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return badRequest("id is required.");
  await prisma.externalWallet.deleteMany({ where: { id, userId: res.user.id } });
  return NextResponse.json({ ok: true });
}
