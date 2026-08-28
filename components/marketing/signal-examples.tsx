import { Badge } from "@/components/ui/badge";
import { SignalScore } from "@/components/product/signal-score";

/*
  Signal examples — real shape of the product's output: a chart sketch
  (flat single-color line, no fills), the callout, and the reasoning.
  The 45° guide on the entry chart is the brand gesture doing real work.
*/
function EntryChart() {
  return (
    <svg viewBox="0 0 340 110" className="w-full" role="img" aria-label="Price chart with entry signal marked at breakout">
      {/* range the price traded in */}
      <line x1="0" y1="34" x2="340" y2="34" stroke="hsl(var(--line))" strokeDasharray="3 4" />
      <line x1="0" y1="78" x2="340" y2="78" stroke="hsl(var(--line))" strokeDasharray="3 4" />
      {/* price */}
      <polyline
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="1.5"
        points="0,70 24,66 44,72 66,64 88,69 108,60 128,66 148,58 168,63 188,55 208,60 224,50"
      />
      {/* breakout leg — the 45° gesture, in amber */}
      <polyline fill="none" stroke="hsl(var(--amber))" strokeWidth="2" points="224,50 262,26 300,14" />
      {/* entry marker */}
      <circle cx="224" cy="50" r="4" fill="hsl(var(--amber))" />
      <text x="216" y="98" fontFamily="var(--font-geist-mono)" fontSize="10" fill="hsl(var(--amber))">
        ENTRY
      </text>
    </svg>
  );
}

function ExitChart() {
  return (
    <svg viewBox="0 0 340 110" className="w-full" role="img" aria-label="Price chart with exit signal marked before rollover">
      <line x1="0" y1="22" x2="340" y2="22" stroke="hsl(var(--line))" strokeDasharray="3 4" />
      <polyline
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="1.5"
        points="0,88 30,76 56,64 80,54 104,42 128,34 152,28 176,24 200,26 216,24"
      />
      {/* decay after the exit mark */}
      <polyline
        fill="none"
        stroke="hsl(var(--faint))"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        points="216,24 244,36 272,52 300,64 340,74"
      />
      <circle cx="216" cy="24" r="4" fill="hsl(var(--amber))" />
      <text x="206" y="12" fontFamily="var(--font-geist-mono)" fontSize="10" fill="hsl(var(--amber))">
        EXIT
      </text>
    </svg>
  );
}

export function SignalExamples() {
  return (
    <section id="signals" className="border-b border-line">
      <div className="mx-auto max-w-wrap px-6 py-16 lg:py-20">
        <div className="mb-12 max-w-2xl">
          <p className="text-label mb-3">Signal examples</p>
          <h2 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            Every callout shows its work
          </h2>
          <p className="text-base text-muted">
            No black box. A signal is a score plus the exact conditions that
            produced it — written the way you&rsquo;d explain it to a friend.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* entry example */}
          <article className="flex flex-col rounded-md border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="flex items-center gap-3">
                <Badge variant="amber">Entry signal</Badge>
                <span className="font-mono text-data-sm text-muted">PEPEX / WETH</span>
              </div>
              <SignalScore score={82} size="sm" />
            </div>
            <div className="px-5 pt-5">
              <EntryChart />
            </div>
            <div className="px-5 pb-5 pt-4">
              <p className="text-sm text-muted">
                <span className="text-bone">Why: </span>
                Price cleared its 3-hour range on 4.1× average volume while
                liquidity grew $48K and no single wallet exceeded 3% of supply.
                LP is locked for 180 days; contract verified with no mint
                authority.
              </p>
            </div>
            <p className="mt-auto border-t border-line px-5 py-2.5 font-mono text-data-sm text-faint">
              Reading at 14:32:08 UTC
            </p>
          </article>

          {/* exit example */}
          <article className="flex flex-col rounded-md border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="flex items-center gap-3">
                <Badge variant="warn">Exit signal</Badge>
                <span className="font-mono text-data-sm text-muted">KILN / WETH</span>
              </div>
              <SignalScore score={38} size="sm" />
            </div>
            <div className="px-5 pt-5">
              <ExitChart />
            </div>
            <div className="px-5 pb-5 pt-4">
              <p className="text-sm text-muted">
                <span className="text-bone">Why: </span>
                Buy pressure flipped negative over 20 minutes, two early wallets
                moved 11% of supply to exchanges, and liquidity fell 18% from its
                peak. Score dropped 33 points in an hour — momentum is gone.
              </p>
            </div>
            <p className="mt-auto border-t border-line px-5 py-2.5 font-mono text-data-sm text-faint">
              Reading at 09:17:44 UTC
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
