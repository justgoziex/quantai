"use client";

import { Badge } from "@/components/ui/badge";
import { SignalScore } from "@/components/product/signal-score";
import { scoreLaunchConfig, type LaunchConfig } from "@/lib/launch";

/*
  Live score preview — recomputes the launch-config gates on every change,
  so creators see exactly how their choices read to traders.
*/
const verdictVariant = { pass: "gain", warn: "warn", fail: "loss" } as const;

export function ScorePreview({ config }: { config: LaunchConfig }) {
  const { score, readings } = scoreLaunchConfig(config);

  return (
    <aside className="min-w-0 rounded-md border border-line bg-panel lg:sticky lg:top-20">
      <div className="border-b border-line px-4 py-3">
        <p className="text-label">Pre-launch reading</p>
      </div>
      <div className="border-b border-line px-4 py-4">
        <SignalScore score={score} />
      </div>
      <ul className="flex flex-col">
        {readings.map((r) => (
          <li
            key={r.gate}
            className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0"
          >
            <div>
              <p className="text-sm text-bone">{r.gate}</p>
              <p className="text-xs text-muted">{r.note}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="font-mono text-data-sm text-muted">
                {r.points}/{r.max}
              </span>
              <Badge variant={verdictVariant[r.verdict]}>{r.verdict}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
