"use client";

import { useState } from "react";
import { PnlCard, type PnlPosition } from "@/components/portfolio/pnl-card";
import { Button } from "@/components/ui/button";

// put in $8.82, worth $15.96
const WIN: PnlPosition = {
  symbol: "PEPEX",
  chain: "ETH",
  investedUsd: 8.82,
  valueUsd: 15.96,
  unrealizedPnlUsd: 7.14,
  realizedPnlUsd: 1.2,
  score: 82,
};

// put in $108, worth $36.90
const LOSS: PnlPosition = {
  symbol: "DRIP",
  chain: "BSC",
  investedUsd: 108,
  valueUsd: 36.9,
  unrealizedPnlUsd: -71.1,
  realizedPnlUsd: -18,
  score: 24,
};

export function PnlDemoClient() {
  const [open, setOpen] = useState<PnlPosition | null>(null);
  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setOpen(WIN)}>Open a winning card</Button>
      <Button variant="secondary" onClick={() => setOpen(LOSS)}>
        Open a losing card
      </Button>
      {open ? <PnlCard position={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
