/*
  Risk gates — bento of the ten checks (Aceternity structural pattern,
  flat execution). Hairline cells, mono indices, hover lifts one surface.
*/
const GATES = [
  { k: "honeypot", title: "Honeypot simulation", body: "A real sell is simulated before you ever see the token. Can't sell? Never listed." },
  { k: "lp-lock", title: "LP lock & burn", body: "Locker contracts and burn addresses checked, with unlock dates surfaced." },
  { k: "mint", title: "Mint authority", body: "Open mint functions flagged — supply that can inflate under you caps the score." },
  { k: "holders", title: "Holder concentration", body: "Top-10 share, sniper clusters, and fresh-wallet ratios mapped from the first block." },
  { k: "verify", title: "Contract verification", body: "Unverified source is a hard flag. Proxy patterns and owner privileges get read." },
  { k: "deployer", title: "Deployer history", body: "The deployer's past launches — rugs, abandons, or clean exits — follow them here." },
  { k: "tax", title: "Buy/sell tax", body: "Effective taxes measured by simulation, not by what the contract claims." },
  { k: "depth", title: "Liquidity depth", body: "How much size the pool actually absorbs before slippage eats the trade." },
  { k: "momentum", title: "Momentum", body: "Buy pressure, unique buyers, and volume acceleration over rolling windows." },
  { k: "trend", title: "Price trend", body: "The shape of the move across 1h/6h/24h — orderly action scores, dumps and blow-off tops don't." },
];

export function RiskGrid() {
  return (
    <section id="risk" className="border-b border-line">
      <div className="mx-auto max-w-wrap px-6 py-16 lg:py-20">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-label mb-3">Ten risk gates</p>
            <h2 className="text-display-lg text-bone" style={{ textWrap: "balance" }}>
              The score is earned, gate by gate
            </h2>
          </div>
          <p className="max-w-xs text-sm text-muted">
            Each gate contributes a documented weight to the composite 0–100.
            Fail a hard gate and the token never reaches your feed.
          </p>
        </div>
        <div className="grid overflow-hidden rounded-md border border-line sm:grid-cols-2 lg:grid-cols-3">
          {GATES.map((g, i) => (
            <div
              key={g.k}
              className="group border-b border-line bg-panel p-6 transition-colors duration-base hover:bg-raised sm:[&:nth-child(2n)]:border-l lg:[&:nth-child(2n)]:border-l-0 lg:[&:nth-child(3n+2)]:border-l lg:[&:nth-child(3n)]:border-l [&:nth-last-child(-n+1)]:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0"
            >
              <p className="mb-3 font-mono text-data-sm text-faint transition-colors duration-base group-hover:text-amber">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="text-h3 mb-1.5 text-bone">{g.title}</h3>
              <p className="text-xs text-muted">{g.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
