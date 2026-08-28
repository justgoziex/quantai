import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withErrors } from "@/lib/route-errors";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getLiquidityPartner } from "@/lib/config";

export const dynamic = "force-dynamic";

/* How long a handoff reference stays good once generated. */
const TTL_HOURS = 48;

/*
  POST /api/dev/liquidity/link — mint a handoff reference for an imported
  wallet, for the developer to send the desk on Telegram.

  Regenerating replaces the previous reference, so a link already sent stops
  resolving. That is the intent: the only live link should be the newest one.
*/
async function postHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (auth.user.role !== "ADMIN" && !(await getLiquidityPartner()).enabled) {
    return NextResponse.json({ error: "Not available yet." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id ?? "");

  /*
    Scope the update to the owner. Taking the id alone would let anyone mint a
    reference against someone else's wallet and hand the desk a record that
    isn't theirs.
  */
  const own = await prisma.liquidityWallet.findFirst({
    where: { id, userId: auth.user.id },
    select: { id: true },
  });
  if (!own) return NextResponse.json({ error: "Wallet not found." }, { status: 404 });

  const ref = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000);

  await prisma.liquidityWallet.update({
    where: { id: own.id },
    data: { handoffRef: ref, handoffExpiresAt: expiresAt, handoffUsedAt: null },
  });

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.quantniumai.com";
  return NextResponse.json({
    ref,
    url: `${base}/admin?liquidity=${ref}`,
    expiresAt,
    expiresInHours: TTL_HOURS,
  });
}

export const POST = withErrors("dev.liquidity.link", postHandler);
