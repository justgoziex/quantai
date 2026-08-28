import { Badge } from "@/components/ui/badge";
import { SignalScore } from "@/components/product/signal-score";

/*
  Screener preview — the hero visual. A static snapshot of the new-pairs
  feed; the real, moving feed lives on /screener.
*/
type Row = {
  id: number;
  token: string;
  pair: string;
  chain: "ETH" | "BSC";
  age: string;
  liq: string;
  score: number;
  flag: { variant: "gain" | "bone" | "warn" | "loss"; text: string };
};

const ROWS: Row[] = [
  { id: 0, token: "PEPEX", pair: "WETH", chain: "ETH", age: "14m", liq: "$182K", score: 82, flag: { variant: "gain", text: "LP locked" } },
  { id: 1, token: "MOGUL", pair: "WBNB", chain: "BSC", age: "1h 02m", liq: "$94K", score: 57, flag: { variant: "bone", text: "Verified" } },
  { id: 2, token: "NOCTA", pair: "WETH", chain: "ETH", age: "3m", liq: "$261K", score: 78, flag: { variant: "gain", text: "LP locked" } },
  { id: 3, token: "DRIP", pair: "WBNB", chain: "BSC", age: "3h 40m", liq: "$21K", score: 24, flag: { variant: "loss", text: "Honeypot" } },
  { id: 4, token: "FUME", pair: "WETH", chain: "ETH", age: "41s", liq: "$310K", score: 71, flag: { variant: "bone", text: "Verified" } },
];

export function ScreenerPreview() {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-label">New pairs · Uniswap + PancakeSwap</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-2 font-mono text-data-sm uppercase tracking-[0.1em] text-faint sm:grid-cols-[1.2fr_auto_auto_auto_auto]">
        <span>Token</span>
        <span className="hidden sm:block">Age</span>
        <span className="hidden text-right sm:block">Liq</span>
        <span>Flag</span>
        <span className="text-right">Signal</span>
      </div>
      <div>
        {ROWS.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-line px-4 py-2.5 sm:grid-cols-[1.2fr_auto_auto_auto_auto]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-bone">{r.token}</p>
              <p className="whitespace-nowrap font-mono text-data-sm text-faint">
                {r.token} / {r.pair}
                <span className="text-muted"> · {r.chain}</span>
              </p>
            </div>
            <span className="hidden font-mono text-data-sm text-muted sm:block">{r.age}</span>
            <span className="hidden text-right font-mono text-data-sm text-bone sm:block">{r.liq}</span>
            <Badge variant={r.flag.variant}>{r.flag.text}</Badge>
            <SignalScore score={r.score} size="sm" className="justify-end" />
          </div>
        ))}
      </div>
    </div>
  );
}
