import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { getNativeBalance } from "@/lib/rpc";
import { getNativeUsd } from "@/lib/native-price";
import { computePositions } from "@/lib/pnl";

/*
  GET /api/portfolio — everything the portfolio page needs in one call:
  balances, positions with PnL, the trade log, and total USD value.
  Demo-aware: when the caller's demo account is enabled, it uses the simulated
  trades + demo cash and prices everything at live prices — no UI difference.
*/
export async function GET(req: Request) {
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const demo = await prisma.demoAccount.findUnique({ where: { userId: res.user.id } });
  const isDemo = demo?.enabled ?? false;

  const wallet = await prisma.wallet.findFirst({ where: { userId: res.user.id } });

  const [ethBalance, bnbBalance, nativeUsd, trades] = await Promise.all([
    !isDemo && wallet ? getNativeBalance("eth", wallet.address) : Promise.resolve(null),
    !isDemo && wallet ? getNativeBalance("bsc", wallet.address) : Promise.resolve(null),
    getNativeUsd(),
    prisma.trade.findMany({
      where: { userId: res.user.id, demo: isDemo },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: {
        token: {
          select: {
            id: true,
            symbol: true,
            name: true,
            chain: true,
            address: true,
            currentScore: true,
            market: true,
            marketCapUsd: true,
          },
        },
      },
    }),
  ]);

  const positionMap = computePositions(
    trades.map((t) => ({
      tokenId: t.tokenId,
      side: t.side,
      amountToken: t.amountToken,
      priceUsd: t.priceUsd,
      occurredAt: t.occurredAt,
    })),
  );

  const tokenById = new Map(trades.map((t) => [t.token.id, t.token]));
  const positions = Array.from(positionMap.values())
    .filter((p) => p.qty > 0 || p.realizedPnlUsd !== 0)
    .map((p) => {
      const token = tokenById.get(p.tokenId);
      const market = (token?.market ?? null) as { priceUsd?: number } | null;
      const priceUsd = market?.priceUsd ?? null;
      return {
        ...p,
        token: token
          ? {
              id: token.id,
              symbol: token.symbol,
              name: token.name,
              chain: token.chain,
              address: token.address,
              score: token.currentScore,
            }
          : null,
        priceUsd,
        valueUsd: priceUsd !== null ? p.qty * priceUsd : null,
        unrealizedPnlUsd: priceUsd !== null ? p.qty * (priceUsd - p.avgCostUsd) : null,
      };
    });

  // total USD value: cash (native balances valued in USD, or demo cash) + holdings
  const holdingsUsd = positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  const cashUsd = isDemo
    ? (demo?.cashUsd ?? 0)
    : (ethBalance ?? 0) * nativeUsd.eth + (bnbBalance ?? 0) * nativeUsd.bnb;
  const totalUsd = cashUsd + holdingsUsd;

  const realizedUsd = positions.reduce((s, p) => s + p.realizedPnlUsd, 0);
  const unrealizedUsd = positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0);
  const investedUsd = positions.reduce((s, p) => s + p.investedUsd, 0);

  // performance curve — cumulative realized PnL stepped at each trade, then a
  // final point that adds current unrealized (mark-to-market) at "now". This
  // is the standard equity curve without needing historical price snapshots.
  const performance = buildPerformance(
    trades.map((t) => ({
      tokenId: t.tokenId,
      side: t.side,
      amountToken: t.amountToken,
      priceUsd: t.priceUsd,
      occurredAt: t.occurredAt,
    })),
    unrealizedUsd,
  );

  return NextResponse.json({
    wallet: isDemo ? null : (wallet?.address ?? null),
    balances: { eth: ethBalance, bnb: bnbBalance },
    nativeUsd,
    cashUsd,
    holdingsUsd,
    totalUsd,
    realizedUsd,
    unrealizedUsd,
    investedUsd,
    totalPnlUsd: realizedUsd + unrealizedUsd,
    roiPct: investedUsd > 0 ? ((realizedUsd + unrealizedUsd) / investedUsd) * 100 : 0,
    performance,
    positions,
    trades,
  });
}

/*
  Equity curve: replay trades in time order, tracking running realized PnL with
  the same average-cost rules as computePositions. Each point is cumulative
  realized PnL at that trade; a trailing point adds current unrealized so the
  curve ends at the trader's true total PnL now.
*/
function buildPerformance(
  trades: { tokenId: string; side: string; amountToken: number; priceUsd: number; occurredAt: Date }[],
  currentUnrealizedUsd: number,
): { t: number; pnl: number }[] {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  if (sorted.length === 0) return [];
  const book = new Map<string, { qty: number; avg: number }>();
  let realized = 0;
  const points: { t: number; pnl: number }[] = [];
  // start at zero, just before the first trade
  points.push({ t: new Date(sorted[0].occurredAt).getTime() - 1, pnl: 0 });
  for (const tr of sorted) {
    const p = book.get(tr.tokenId) ?? { qty: 0, avg: 0 };
    if (tr.side === "BUY") {
      const nq = p.qty + tr.amountToken;
      p.avg = nq > 0 ? (p.qty * p.avg + tr.amountToken * tr.priceUsd) / nq : 0;
      p.qty = nq;
    } else {
      const sq = Math.min(tr.amountToken, p.qty);
      realized += sq * (tr.priceUsd - p.avg);
      p.qty -= sq;
      if (p.qty <= 0) {
        p.qty = 0;
        p.avg = 0;
      }
    }
    book.set(tr.tokenId, p);
    points.push({ t: new Date(tr.occurredAt).getTime(), pnl: realized });
  }
  // trailing mark-to-market point at "now"
  points.push({ t: Date.now(), pnl: realized + currentUnrealizedUsd });
  return points;
}
