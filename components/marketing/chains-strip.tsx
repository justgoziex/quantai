import { EthLogo, BnbLogo, RhLogo, SolLogo, BaseLogo } from "@/components/brand/chain-logo";

/*
  Supported-chains band — makes the ETH + BNB + Base + Robinhood footing explicit on
  the landing page, with the real chain marks.
*/
const CHAINS = [
  { name: "Ethereum", tag: "Uniswap v2/v3 · WETH pairs", Logo: EthLogo },
  { name: "BNB Chain", tag: "PancakeSwap v2/v3 · WBNB pairs", Logo: BnbLogo },
  { name: "Base", tag: "Uniswap v2/v3 · Aerodrome", Logo: BaseLogo },
  { name: "Robinhood", tag: "Robinhood Chain · screening", Logo: RhLogo },
  { name: "Solana", tag: "Solana · screening", Logo: SolLogo },
];

export function ChainsStrip() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-wrap sm:grid-cols-2 lg:grid-cols-4">
        {CHAINS.map(({ name, tag, Logo }, i) => (
          <div
            key={name}
            className={
              "flex items-center gap-4 px-6 py-7 " +
              (i > 0 ? "border-t border-line sm:border-l sm:border-t-0" : "")
            }
          >
            <Logo size={40} brand />
            <div>
              <p className="text-h3 text-bone">{name}</p>
              <p className="font-mono text-data-sm text-muted">{tag}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
