import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { verifyMessage, isAddress } from "viem";
import { isSolAddress, verifySolSignature } from "@/lib/solana";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, badRequest, dbUnavailable } from "@/lib/api";

export const dynamic = "force-dynamic";

/*
  Developer wallet linking — proves the caller controls the deployer wallet by
  verifying a signed message (same pattern as the trader-cashback wallets).
  GET    → the caller's verified dev wallets
  POST   → { address, message, signature } link one
  DELETE → { id } unlink
*/
async function getHandler(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;
  const profiles = await prisma.devProfile.findMany({
    where: { userId: res.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      wallet: true,
      verified: true,
      name: true,
      contact: true,
      createdAt: true,
      privateKey: true,
    },
  });

  /*
    Report what kind of wallet each one is, never the key itself.

    `imported` decides whether creator cashback is open to it, and `vm` lets
    the portal ask for the chain that's missing — a developer with a Solana
    deployer should be invited to add an EVM one, not asked again for what they
    already have.
  */
  const shaped = profiles.map(({ privateKey, wallet, ...rest }) => ({
    ...rest,
    wallet,
    imported: privateKey !== null,
    vm: isSolAddress(wallet) ? ("svm" as const) : ("evm" as const),
  }));

  return NextResponse.json({
    profiles: shaped,
    // which side is still missing, so the portal can ask for exactly that
    hasEvm: shaped.some((p) => p.vm === "evm"),
    hasSol: shaped.some((p) => p.vm === "svm"),
  });
}

async function postHandler(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    message?: string;
    signature?: string;
    name?: string;
    contact?: string;
  } | null;
  if (!body) return badRequest("Missing payload.");

  /*
    Two wallet worlds. EVM addresses are hex and case-insensitive; Solana is
    base58 and case-sensitive, signs with ed25519 and has no recovery — so the
    address is kept verbatim and the signature checked against it directly.
  */
  const raw = String(body.address ?? "").trim();
  const solana = isSolAddress(raw);
  const address = solana ? raw : raw.toLowerCase();
  const message = String(body.message ?? "");
  const signature = String(body.signature ?? "");

  if (!solana && !isAddress(address)) return badRequest("Enter a valid wallet address.");
  if (!message || !signature) return badRequest("A wallet signature is required.");
  if (!message.toLowerCase().includes(`dev wallet ${address.toLowerCase()}`)) {
    return badRequest("That signature doesn't match this wallet.");
  }

  let ok = false;
  try {
    ok = solana
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

  const profile = await prisma.devProfile.upsert({
    where: { userId_wallet: { userId: res.user.id, wallet: address } },
    update: {
      verified: true,
      /*
        Verifying a wallet brings it back into view.

        Clearing a wallet with the × hides the row rather than deleting it, so
        its listings and fee history survive. Without resetting that here, a
        developer who cleared a wallet and then verified it again saw the
        success message and an empty list — the profile existed, updated, and
        stayed hidden.
      */
      hidden: false,
      ...(body.name ? { name: String(body.name).slice(0, 60) } : {}),
      ...(body.contact ? { contact: String(body.contact).slice(0, 120) } : {}),
    },
    create: {
      userId: res.user.id,
      wallet: address,
      verified: true,
      name: body.name ? String(body.name).slice(0, 60) : null,
      contact: body.contact ? String(body.contact).slice(0, 120) : null,
    },
    select: { id: true, wallet: true, verified: true, createdAt: true },
  });
  return NextResponse.json({ profile }, { status: 201 });
}

/*
  DELETE /api/dev/wallet — clear a wallet from the developer's view.

  Deliberately no longer a deletion. Listings, promoted slots and fee payments
  all point at this profile, and removing the row orphaned the record of what
  was paid for and when. Hiding keeps that history intact while letting the
  developer swap to another wallet, and re-importing the same one later brings
  it back rather than creating a duplicate.
*/
async function deleteHandler(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id ?? url.searchParams.get("id") ?? "");
  if (!id) return badRequest("id is required.");

  /*
    Nothing is removed and nothing is concealed.

    Hiding was introduced so a developer could clear a wallet from view, and it
    caused precisely the confusion it was meant to prevent: a wallet that
    verified successfully stayed invisible because an earlier removal still
    applied. A developer's wallets are a matter of record — they stay in the
    database and they stay on screen.
  */
  return NextResponse.json({ ok: true, removed: "none" });
}

export const GET = withErrors("dev.wallet", getHandler);

export const POST = withErrors("dev.wallet", postHandler);

export const DELETE = withErrors("dev.wallet", deleteHandler);
