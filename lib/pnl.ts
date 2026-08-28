/*
  Position accounting — average-cost basis, documented and deterministic.
  BUY:  avgCost' = (qty·avgCost + amt·price) / (qty + amt)
  SELL: realized += min(amt, qty) · (price − avgCost); qty decreases.
  Sells beyond the tracked quantity are clamped (manual logs can be partial).
*/
export type TradeInput = {
  tokenId: string;
  side: "BUY" | "SELL";
  amountToken: number;
  priceUsd: number;
  occurredAt: string | Date;
};

export type Position = {
  tokenId: string;
  qty: number;
  avgCostUsd: number;
  investedUsd: number;
  realizedPnlUsd: number;
};

export function computePositions(trades: TradeInput[]): Map<string, Position> {
  const positions = new Map<string, Position>();
  const sorted = [...trades].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  for (const t of sorted) {
    const p = positions.get(t.tokenId) ?? {
      tokenId: t.tokenId,
      qty: 0,
      avgCostUsd: 0,
      investedUsd: 0,
      realizedPnlUsd: 0,
    };
    if (t.side === "BUY") {
      const newQty = p.qty + t.amountToken;
      p.avgCostUsd = newQty > 0 ? (p.qty * p.avgCostUsd + t.amountToken * t.priceUsd) / newQty : 0;
      p.qty = newQty;
      p.investedUsd += t.amountToken * t.priceUsd;
    } else {
      const sellQty = Math.min(t.amountToken, p.qty);
      p.realizedPnlUsd += sellQty * (t.priceUsd - p.avgCostUsd);
      p.qty -= sellQty;
      if (p.qty <= 0) {
        p.qty = 0;
        p.avgCostUsd = 0;
      }
    }
    positions.set(t.tokenId, p);
  }
  return positions;
}
