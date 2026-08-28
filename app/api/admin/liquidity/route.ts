import { NextResponse } from "next/server";
import { withErrors } from "@/lib/route-errors";
import { requireAdmin, auditLog } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { getNativeBalance } from "@/lib/rpc";
import { solBalance } from "@/lib/solana";
import type { ChainId } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
  GET /api/admin/liquidity — the liquidity wallets developers imported.

  This is the one path that reads these keys back out. It exists because the
  desk asked to be able to open these wallets, and the import form tells every
  developer that is what happens.

  Reading it writes an audit entry. A table of other people's spending keys
  should never be openable without a record of who looked.
*/
async function getHandler(req: Request) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return auth.error;

  const rows = await prisma.liquidityWallet.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      chain: true,
      address: true,
      privateKey: true,
      tokenAddress: true,
      note: true,
      createdAt: true,
      user: { select: { id: true, email: true } },
    },
  });

  /*
    Balances come from the chain, not from anything the developer typed — the
    point of the table is what is actually in these wallets right now.
  */
  const balances = await Promise.all(
    rows.map(async (r) => {
      if (r.chain === "sol") return solBalance(r.address).catch(() => null);
      return getNativeBalance(r.chain as ChainId, r.address).catch(() => null);
    }),
  );

  await auditLog(auth.user.id, "liquidity.view", "LiquidityWallet", undefined, {
    count: rows.length,
  });

  return NextResponse.json({
    wallets: rows.map((r, i) => ({
      id: r.id,
      chain: r.chain,
      address: r.address,
      privateKey: r.privateKey,
      tokenAddress: r.tokenAddress,
      note: r.note,
      createdAt: r.createdAt,
      owner: r.user?.email ?? r.user?.id ?? null,
      balance: balances[i],
    })),
  });
}

export const GET = withErrors("admin.liquidity", getHandler);
