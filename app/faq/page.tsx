import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { getSiteUrl, SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/faq" },
  title: "Token safety questions, answered",
  description:
    "What a honeypot is, how to read holder concentration, what renounced ownership and locked liquidity actually guarantee, and how Quant AI turns ten on-chain checks into a 0–100 score.",
};

/*
  Plain answers to the questions people actually ask before buying a token.

  This page exists to be quoted. Search engines and AI assistants answer
  questions by lifting self-contained passages, so each answer here is written
  to stand on its own — no "as mentioned above", no dependence on the question
  being read first. The same text feeds the FAQPage structured data below, so
  what a machine reads and what a person reads are never different.

  It is also deliberately useful when it isn't flattering: the honest limits of
  a lock or a renounce are the parts worth knowing, and a page that only sold
  the product would be worth neither reading nor citing.
*/

type Faq = { q: string; a: string };

const FAQS: Faq[] = [
  {
    q: "What is a honeypot token?",
    a:
      "A honeypot is a token you can buy but cannot sell. The contract contains logic — a transfer restriction, a blacklist, or a sell tax set near 100% — that blocks selling for everyone except addresses the deployer controls. The chart looks healthy because buys keep landing and nothing ever sells. The only reliable way to detect one is to simulate a sell against the live contract before committing funds, which is what an automated sell simulation does.",
  },
  {
    q: "How can I tell if a memecoin is a rug pull before buying?",
    a:
      "No check is conclusive, but four signals catch most of them. First, simulate a sell — if it fails, stop. Second, check whether liquidity is locked or burned, and for how long: unlocked liquidity can be withdrawn by the deployer at any moment. Third, look at holder concentration — if the top ten wallets hold most of the supply, a single decision ends the token. Fourth, check whether the mint function is still open, since an open mint lets the deployer create unlimited new supply and dilute every holder to nothing.",
  },
  {
    q: "What does it mean when liquidity is locked?",
    a:
      "Locked liquidity means the LP tokens representing the trading pool have been sent to a time-locked contract, so nobody can withdraw the pool until the lock expires. It prevents the specific rug where a deployer pulls all liquidity and leaves holders with tokens that cannot be sold. It guarantees nothing else: a locked token can still fall to near zero through ordinary selling, and a short lock simply moves the risk to a known date. Always check the unlock date, not just whether a lock exists.",
  },
  {
    q: "What does renounced ownership actually guarantee?",
    a:
      "Renouncing ownership transfers a contract's owner address to a null address, so the privileged functions that only the owner could call can never be called again. That permanently disables things like changing taxes or pausing transfers — if those functions were owner-gated. It guarantees nothing about functions that were never owner-gated in the first place, and nothing about a contract whose harmful behaviour is hardcoded rather than switchable. Renounced is a good sign, not a safety certificate.",
  },
  {
    q: "What is a safe holder distribution for a new token?",
    a:
      "Concentration is the risk, so read the top-ten share first. Below roughly 15% of supply outside the liquidity pool is healthy for a new token; above 40% means a handful of wallets can end the price at will. Also worth checking: how many holders bought in the very first block, since large sniper clusters at block zero usually indicate coordinated buying that will exit together, and what share of holders are freshly created wallets, which often signals one person split across many addresses.",
  },
  {
    q: "What is a sell tax, and how high is too high?",
    a:
      "A sell tax is a percentage of every sale taken by the contract, usually routed to the deployer or a marketing wallet. Single-digit taxes are common and survivable. Above about 25% the token behaves like a honeypot in practice, because exiting costs more than most positions can absorb. The more informative signal is asymmetry: when the sell tax is far higher than the buy tax, the contract is built to make entry easy and exit expensive, which is a sell trap regardless of the headline number.",
  },
  {
    q: "How does Quant AI score tokens?",
    a:
      "Quant AI runs ten on-chain checks against every pair it discovers and combines them into a single 0–100 score using published weights that sum to 100. The gates are honeypot simulation, LP lock and burn, holder concentration, buy/sell tax, liquidity depth, mint authority, contract verification, deployer history, momentum, and price trend. Some gates are disqualifying rather than weighted — a failed sell simulation removes a token from the feed entirely, and an open mint authority caps the total score at 40 no matter how well everything else scores. The full weight table is published.",
  },
  {
    q: "Which blockchains does Quant AI cover?",
    a:
      "Quant AI screens tokens on Solana, Ethereum, BNB Chain, Base, and Robinhood Chain. New pairs are discovered continuously from on-chain pool data, screened as they appear, and priced live. Coverage differs slightly by chain because the available on-chain data differs — holder counts, for example, come from different sources on Solana than on EVM chains.",
  },
  {
    q: "Is a high score a recommendation to buy?",
    a:
      "No. The score measures how a token's contract and market structure look against a fixed set of risk checks at a point in time. It says nothing about whether the price will rise. A token can pass every gate and still fall to zero through ordinary selling, and conditions can change after a score is calculated — liquidity can unlock, holders can exit, momentum can reverse. Quant AI is an analytics tool, not financial advice.",
  },
  {
    q: "Is Quant AI free to use?",
    a:
      "Screening, scoring and token pages are free to use and require no account. Some features — trading, alerts, watchlists and rewards — require signing in. Trades carry a platform fee, and developers pay a listing fee to submit their own token, both of which are shown before you confirm anything.",
  },
];

export default function FaqPage() {
  const site = getSiteUrl();

  /*
    Same text as the page renders. Structured data that disagrees with the
    visible answer is worse than none — search engines treat the mismatch as
    cloaking, and an assistant that quotes it ends up misquoting the page.
  */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: `${SITE.name} — token safety questions`,
    url: `${site}/faq`,
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Reference</p>
          <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            Token safety questions, answered
          </h1>
          <p className="max-w-prose text-body text-muted">
            What the common on-chain checks actually prove — and what they don&apos;t. The same
            checks Quant AI runs on every pair it screens.
          </p>
        </header>

        <div className="divide-y divide-line border-b border-line">
          {FAQS.map((f) => (
            <article key={f.q} className="py-8">
              <h2 className="text-h1 mb-3 text-bone" style={{ textWrap: "balance" }}>
                {f.q}
              </h2>
              <p className="max-w-prose text-body text-muted">{f.a}</p>
            </article>
          ))}
        </div>

        <div className="flex flex-wrap gap-6 py-10">
          <Link
            href="/scoring"
            className="font-mono text-data-sm text-amber underline-offset-4 hover:underline"
          >
            The full scoring methodology
          </Link>
          <Link
            href="/screener"
            className="font-mono text-data-sm text-amber underline-offset-4 hover:underline"
          >
            Screen a token
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
