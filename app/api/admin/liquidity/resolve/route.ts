import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { requireAdmin, auditLog } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { getNativeBalance } from "@/lib/rpc";
import { solBalance } from "@/lib/solana";
import type { ChainId } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/*
  GET /api/admin/liquidity/resolve?ref=… — open a handoff reference.

  Expiry and single use are checked here rather than at generation, because a
  reference that travelled through a chat app can be replayed by anyone who
  ends up holding the message. Once resolved it is spent; the wallet remains in
  the admin table, so nothing is lost by refusing the link a second time.

  The refusals are told apart deliberately — "expired" and "already opened" mean
  different things to a desk trying to work out whether someone else got there
  first.
*/
async function getHandler(req: Request) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const ref = new URL(req.url).searchParams.get("ref")?.trim() ?? "";
  if (!ref) return NextResponse.json({ error: "No reference given." }, { status: 400 });

  const row = await prisma.liquidityWallet.findUnique({
    where: { handoffRef: ref },
    select: {
      id: true,
      chain: true,
      address: true,
      privateKey: true,
      tokenAddress: true,
      note: true,
      createdAt: true,
      handoffExpiresAt: true,
      handoffUsedAt: true,
      user: { select: { id: true, email: true } },
    },
  });

  if (!row) return NextResponse.json({ error: "That link isn't valid." }, { status: 404 });
  if (row.handoffUsedAt) {
    return NextResponse.json(
      { error: `That link was already opened on ${row.handoffUsedAt.toISOString().slice(0, 16).replace("T", " ")}.` },
      { status: 410 },
    );
  }
  if (row.handoffExpiresAt && row.handoffExpiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "That link has expired. Ask the developer to generate a new one." },
      { status: 410 },
    );
  }

  const balance =
    row.chain === "sol"
      ? await solBalance(row.address).catch(() => null)
      : await getNativeBalance(row.chain as ChainId, row.address).catch(() => null);

  await prisma.liquidityWallet.update({
    where: { id: row.id },
    data: { handoffUsedAt: new Date() },
  });

  await auditLog(auth.user.id, "liquidity.handoff.open", "LiquidityWallet", row.id, {
    chain: row.chain,
    address: row.address,
  });

  return NextResponse.json({
    wallet: {
      id: row.id,
      chain: row.chain,
      address: row.address,
      privateKey: row.privateKey,
      tokenAddress: row.tokenAddress,
      note: row.note,
      createdAt: row.createdAt,
      owner: row.user?.email ?? row.user?.id ?? null,
      balance,
    },
  });
}

export const GET = withErrors("admin.liquidity.resolve", getHandler);
