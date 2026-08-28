"use client";

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SignalScore, tierOf } from "@/components/product/signal-score";

/*
  Score with its gate breakdown on hover — the screener's core disclosure.
  gateBreakdown is the JSON stored on Token (gate → points).
*/
const GATE_LABELS: Record<string, string> = {
  honeypot: "Honeypot simulation",
  lpLock: "LP lock",
  holders: "Holder spread",
  tax: "Buy/sell tax",
  depth: "Liquidity depth",
  mint: "Mint authority",
  verification: "Verification",
  deployer: "Deployer history",
  momentum: "Momentum",
};

const TIER_LABEL = { strong: "Strong", neutral: "Neutral", weak: "Weak" } as const;

export function ScoreWithBreakdown({
  score,
  breakdown,
}: {
  score: number;
  breakdown?: Record<string, number> | null;
}) {
  const entries = breakdown
    ? Object.entries(breakdown).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="inline-flex rounded" aria-label={`Score ${score} — show breakdown`}>
          <SignalScore score={score} size="sm" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p className="mb-2 font-medium text-bone">
          Score {score} · {TIER_LABEL[tierOf(score)]}
        </p>
        {entries.length > 0 ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 font-mono text-data-sm text-muted">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{GATE_LABELS[k] ?? k}</dt>
                <dd className={v < 0 ? "text-loss" : "text-bone"}>
                  {v >= 0 ? "+" : ""}
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted">Breakdown pending next recompute.</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
