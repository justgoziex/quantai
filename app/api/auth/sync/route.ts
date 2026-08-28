import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { verifyBearer } from "@/lib/auth-server";
import { dbUnavailable, unauthorized, makeReferralCode } from "@/lib/api";

/*
  POST /api/auth/sync — called after login. Verifies the Privy token,
  upserts the user + wallet, mints a referral code on first sync, and
  attributes a referral if a code was carried through sign-up.
*/
export async function POST(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const identity = await verifyBearer(req);
  if (!identity) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    walletAddress?: string;
    solanaAddress?: string;
    referralCode?: string;
    deviceFingerprint?: string;
  };

  const user = await prisma.user.upsert({
    where: { privyId: identity.privyId },
    update: {
      email: body.email ?? undefined,
      deviceFingerprint: body.deviceFingerprint ?? undefined,
    },
    create: {
      privyId: identity.privyId,
      email: body.email ?? null,
      deviceFingerprint: body.deviceFingerprint ?? null,
      referralCode: { create: { code: makeReferralCode() } },
    },
    include: { referralCode: true, wallets: true },
  });

  // first sync created no code for pre-existing users — backfill
  if (!user.referralCode) {
    await prisma.referralCode.create({
      data: { userId: user.id, code: makeReferralCode() },
    });
  }

  if (body.walletAddress) {
    await prisma.wallet.upsert({
      where: { address: body.walletAddress },
      update: {},
      create: { userId: user.id, address: body.walletAddress },
    });
  }

  /*
    The Solana wallet is stored as its own row, tagged by provider. It can't
    share the EVM row — the two addresses are different formats for different
    chains — and the tag is what keeps an EVM balance read from picking up a
    base58 address and quietly returning nothing.
  */
  if (body.solanaAddress) {
    await prisma.wallet.upsert({
      where: { address: body.solanaAddress },
      update: {},
      create: { userId: user.id, address: body.solanaAddress, provider: "privy-solana" },
    });
  }

  // referral attribution: first sync only; blocks self-referral by account
  // and by device fingerprint (same machine farming accounts)
  if (body.referralCode) {
    const code = await prisma.referralCode.findUnique({
      where: { code: body.referralCode },
      include: { user: { select: { deviceFingerprint: true } } },
    });
    const alreadyReferred = await prisma.referral.findUnique({
      where: { referredUserId: user.id },
    });
    const sameDevice =
      Boolean(body.deviceFingerprint) &&
      code?.user.deviceFingerprint === body.deviceFingerprint;
    if (code && code.userId !== user.id && !alreadyReferred && !sameDevice) {
      await prisma.referral.create({
        data: { codeId: code.id, referrerId: code.userId, referredUserId: user.id },
      });
    }
  }

  return NextResponse.json({ ok: true, userId: user.id });
}
