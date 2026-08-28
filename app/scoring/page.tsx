import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { SignalScore } from "@/components/product/signal-score";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  alternates: { canonical: "/scoring" },
  title: "How scoring works",
  description:
    "The documented rule-based methodology behind the Quant AI signal score: ten gates, published weights, no black box.",
};

/*
  The documented market-score weights. The screener implementation (live data
  phase) computes to this exact table; the launcher previews the config subset.
*/
const GATES = [
  { gate: "Honeypot simulation", weight: 15, hard: true, desc: "A sell is simulated against the contract. Failure is disqualifying — the token never reaches the feed." },
  { gate: "LP lock & burn", weight: 18, hard: false, desc: "Locker and burn coverage, weighted by duration and share of liquidity locked. Approaching unlocks decay the points." },
  { gate: "Holder concentration", weight: 12, hard: false, desc: "Top-10 share, sniper clusters at block zero, fresh-wallet ratio among buyers." },
  { gate: "Buy/sell tax", weight: 8, hard: false, desc: "Effective taxes by simulation. Above 25% counts as a honeypot; a sell tax far above the buy tax flags a sell-trap and caps the score." },
  { gate: "Liquidity depth", weight: 8, hard: false, desc: "How much size the pool absorbs within tolerable slippage, relative to market cap." },
  { gate: "Mint authority", weight: 10, hard: false, desc: "Open mint functions cap the total score at 40 regardless of other gates." },
  { gate: "Contract verification", weight: 6, hard: false, desc: "Verified source, proxy pattern analysis, privileged-function inventory." },
  { gate: "Deployer / ownership", weight: 5, hard: false, desc: "Renounced ownership and deployer track record — rugs, abandons, clean exits." },
  { gate: "Momentum", weight: 8, hard: false, desc: "Buy pressure, unique buyers, volume acceleration over rolling windows." },
  { gate: "Price trend", weight: 10, hard: false, desc: "The shape of the move across 1h/6h/24h — rewards sustained, orderly action; penalizes dumps and parabolic blow-off tops." },
];

export default function ScoringPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Methodology</p>
          <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            How the score is computed
          </h1>
          <p className="max-w-2xl text-base text-muted">
            The signal score is rule-based and fully documented — ten gates,
            published weights, deterministic output. No model you can&rsquo;t
            audit, no inputs you can&rsquo;t see.
          </p>
        </header>

        {/* tiers */}
        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-6 text-bone">Reading the number</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { score: 82, label: "70–100 · Strong", desc: "Structure passed cleanly. Signals fire from this tier." },
              { score: 57, label: "40–69 · Neutral", desc: "Tradeable but flawed — read the gate breakdown before acting." },
              { score: 24, label: "0–39 · Weak", desc: "Failed or barely passed key gates. Shown for completeness, flagged everywhere." },
            ].map((t) => (
              <div key={t.label} className="rounded-md border border-line bg-panel p-5">
                <SignalScore score={t.score} size="sm" className="mb-3" />
                <p className="mb-1 font-mono text-data-sm text-bone">{t.label}</p>
                <p className="text-xs text-muted">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* weights table */}
        <section className="border-b border-line py-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-h1 text-bone">The ten gates</h2>
            <p className="font-mono text-data-sm text-muted">weights sum to 100</p>
          </div>
          <div className="overflow-hidden rounded-md border border-line">
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-5 border-b border-line bg-panel px-5 py-2.5 font-mono text-data-sm uppercase tracking-[0.1em] text-muted sm:grid-cols-[auto_1fr_auto_auto]">
              <span>#</span>
              <span>Gate</span>
              <span className="hidden sm:block">Type</span>
              <span className="text-right">Weight</span>
            </div>
            {GATES.map((g, i) => (
              <div
                key={g.gate}
                className="grid grid-cols-[auto_1fr_auto] items-start gap-x-5 border-b border-line bg-panel px-5 py-4 last:border-0 sm:grid-cols-[auto_1fr_auto_auto]"
              >
                <span className="pt-0.5 font-mono text-data-sm text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-medium text-bone">{g.gate}</p>
                  <p className="mt-0.5 max-w-xl text-xs text-muted">{g.desc}</p>
                </div>
                <span className="hidden pt-0.5 sm:block">
                  {g.hard ? <Badge variant="loss">Hard gate</Badge> : <Badge>Weighted</Badge>}
                </span>
                <span className="pt-0.5 text-right font-mono text-data text-bone">{g.weight}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-2xl text-xs text-muted">
            Hard gates disqualify outright. Two structural caps apply on top of
            the weights: open mint authority caps the score at 40, and fully
            unlocked LP caps it at 55. Scores recompute continuously as chain
            state changes.
          </p>
        </section>

        {/* signals vs score */}
        <section className="py-10">
          <h2 className="text-h1 mb-4 text-bone">Score vs. signal</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-panel p-5">
              <p className="text-label mb-2">Score</p>
              <p className="text-sm text-muted">
                A continuous reading of on-chain structure, 0–100, recomputed as
                the chain moves. It answers: <span className="text-bone">how solid is this token right now?</span>
              </p>
            </div>
            <div className="rounded-md border border-line bg-panel p-5">
              <p className="text-label mb-2">Signal</p>
              <p className="text-sm text-muted">
                A discrete event — entry, exit, or risk — fired when score and
                market conditions cross documented thresholds. It answers:{" "}
                <span className="text-bone">what just changed?</span>
              </p>
            </div>
          </div>
          <div className="mt-8">
            <Button asChild>
              <Link href="/signals">See signal examples</Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
