import { EthLogo, BnbLogo, RhLogo, SolLogo } from "@/components/brand/chain-logo";

/*
  How it works — numbered because it IS a sequence. Asymmetric split:
  an Ethereum visual left with the two chain marks, steps right.
*/
const STEPS = [
  {
    n: "01",
    title: "Sign in, get a wallet",
    body: "Gmail sign-in provisions an embedded wallet on the spot. Non-custodial — Quant AI never holds your private keys, and there's nothing to seed or install.",
  },
  {
    n: "02",
    title: "Every new pair, screened",
    body: "The moment a pair hits Ethereum, BNB Chain, Base, Solana or Robinhood, it runs ten risk gates: honeypot simulation, LP lock, mint authority, holder concentration, price trend and more.",
  },
  {
    n: "03",
    title: "Signals with reasoning",
    body: "Scored 0–100. In-app or Telegram.",
  },
  {
    n: "04",
    title: "Trade or launch on-chain",
    body: "Swap straight from your embedded wallet through Uniswap or PancakeSwap, with every fill logged to your live PnL. Or deploy your own ERC-20 in a few clicks with the launch wizard.",
  },
  {
    n: "05",
    title: "Earn as you trade",
    body: "Trade to earn. Refer to earn more.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-line">
      <div className="mx-auto grid max-w-wrap lg:grid-cols-[5fr_7fr]">
        {/* generated panel — no image: grid field, live signal gauge, chain marks */}
        <div className="relative hidden min-h-[480px] overflow-hidden border-r border-line bg-ink lg:block">
          <div
            className="absolute inset-0 opacity-[0.5]"
            aria-hidden="true"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
              backgroundSize: "34px 34px",
            }}
          />
          <div
            className="absolute -right-16 top-10 h-72 w-72 rounded-full"
            aria-hidden="true"
            style={{ background: "radial-gradient(closest-side, rgba(238,160,43,0.18), transparent)" }}
          />

          {/* chain marks — Ethereum · BNB Chain · Robinhood */}
          <div className="absolute left-6 top-6 flex flex-wrap items-center gap-2.5">
            {[
              { Mark: EthLogo, label: "Ethereum" },
              { Mark: BnbLogo, label: "BNB Chain" },
              { Mark: RhLogo, label: "Robinhood" },
              { Mark: SolLogo, label: "Solana" },
            ].map(({ Mark, label }) => (
              <span
                key={label}
                className="flex items-center gap-2 rounded-full border border-bone/15 bg-panel/60 px-3 py-1.5 backdrop-blur-sm"
              >
                <Mark size={15} brand />
                <span className="font-mono text-data-sm text-bone">{label}</span>
              </span>
            ))}
          </div>

          {/* live signal gauge — pure SVG, deterministic */}
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-5">
            <svg viewBox="0 0 220 120" className="w-[62%]" role="img" aria-label="Signal reading">
              <polyline
                points="4,96 26,88 48,92 70,70 92,74 114,50 136,58 158,32 180,40 202,16"
                fill="none"
                stroke="#EEA02B"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="202" cy="16" r="4.5" fill="#EEA02B" />
              <circle cx="202" cy="16" r="9" fill="none" stroke="#EEA02B" strokeOpacity="0.4" strokeWidth="1.5" className="motion-safe:animate-live-pulse" />
            </svg>
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-display-lg tabular text-bone">82</span>
              <span className="text-data text-muted">/ 100 signal</span>
            </div>
            <span className="flex items-center gap-1.5 font-mono text-data-sm text-gain">
              <span className="h-1.5 w-1.5 rounded-full bg-gain motion-safe:animate-live-pulse" aria-hidden="true" />
              GOOD ENTRY · live
            </span>
          </div>

          <p className="absolute bottom-4 left-6 font-mono text-data-sm text-bone/70">
            Speed only counts with structure.
          </p>
        </div>
        <div>
          <div className="border-b border-line px-6 py-10 lg:px-12">
            <p className="text-label mb-3">How it works</p>
            <h2 className="text-display-lg text-bone" style={{ textWrap: "balance" }}>
              From new pair to scored signal in under a minute
            </h2>
          </div>
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={
                "group px-6 py-8 transition-colors duration-base hover:bg-panel lg:px-12 " +
                (i > 0 ? "border-t border-line" : "")
              }
            >
              <div className="flex gap-6">
                <span className="font-mono text-data text-faint transition-colors duration-base group-hover:text-amber">
                  {s.n}
                </span>
                <div>
                  <h3 className="text-h2 mb-2 text-bone">{s.title}</h3>
                  <p className="max-w-lg text-sm text-muted">{s.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
