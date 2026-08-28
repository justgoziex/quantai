import { cn } from "@/lib/utils";
import { HOLDER_PAGE_CAP } from "@/lib/format";

/*
  Right-rail panels: buy/sell pressure and holder distribution.
  Flat bars only; semantic color carries the meaning.
*/
export function PressurePanel({ buys, sells }: { buys: number; sells: number }) {
  const total = Math.max(buys + sells, 1);
  const buyPct = Math.round((buys / total) * 100);

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-2.5">
        <span className="text-label">Buy/sell pressure · 1h</span>
      </div>
      <div className="px-4 py-4">
        <div className="mb-2 flex items-baseline justify-between font-mono text-data">
          <span className="text-gain">{buyPct}% buys</span>
          <span className="text-loss">{100 - buyPct}% sells</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-sm" aria-hidden="true">
          <span className="bg-gain" style={{ width: `${buyPct}%` }} />
          <span className="flex-1 bg-loss/70" />
        </div>
        <p className="mt-2.5 font-mono text-data-sm text-muted">
          {buys} buys · {sells} sells
        </p>
      </div>
    </div>
  );
}

export function HoldersPanel({
  holders,
  topHolders,
}: {
  holders: number;
  topHolders: { label: string; pct: number }[];
}) {
  const top10 = topHolders.reduce((s, h) => s + h.pct, 0);
  const max = Math.max(...topHolders.map((h) => h.pct), 1);

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-label">Holders</span>
        <span className="font-mono text-data-sm text-muted">
          top 10 hold {top10.toFixed(1)}%
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-4">
        {topHolders.map((h, i) => (
          <div key={h.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2">
            <span className="font-mono text-data-sm text-faint">{h.label}</span>
            <span className="h-1.5 rounded-sm bg-raised" aria-hidden="true">
              <span
                className={cn("block h-full rounded-sm", i === 0 && h.pct > 8 ? "bg-warn" : "bg-bone/60")}
                style={{ width: `${Math.min((h.pct / max) * 100, 100)}%` }}
              />
            </span>
            <span className="font-mono text-data-sm tabular text-muted">{h.pct.toFixed(1)}%</span>
          </div>
        ))}
        <p className="mt-2 font-mono text-data-sm text-faint">
          {holders === HOLDER_PAGE_CAP
            ? "over 1,000 holders"
            : `${Intl.NumberFormat("en-US").format(holders)} holders total`}
        </p>
      </div>
    </div>
  );
}
