import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { getSiteUrl, SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  title: "About Quant AI",
  description:
    "Quant AI is an on-chain token screener for Solana, Ethereum, Base and BNB Chain. It is not affiliated with the 'Quantum AI' automated trading schemes, makes no return promises, and never takes custody of funds.",
};

/*
  Who runs this, what it does, and what it explicitly is not.

  The name sits one letter away from "Quantum AI" — the brand used by a large
  family of fake celebrity-endorsed trading bots. Search engines and AI
  assistants pattern-match on that resemblance, and with no contact details, no
  linked profiles and no third-party mentions to weigh against it, the honest
  conclusion available to a machine was that this is another one of them.

  Absence of evidence is what caused that, so this page supplies evidence: a
  plain statement of what the product does, an explicit disavowal of the brand
  it gets confused with, and the limits of what it claims. The disavowal is
  also in the structured data, because the association is machine-made and has
  to be answered where machines read.
*/

const NOT = [
  {
    t: "Not an automated trading bot",
    d: "Quant AI does not trade on your behalf, run a managed account, or execute a strategy for you. Every trade is one you choose and sign yourself.",
  },
  {
    t: "No return promises, ever",
    d: "There is no projected yield, no daily percentage, and no performance claim anywhere in the product. A score measures contract and market risk at a point in time — it does not predict price.",
  },
  {
    t: "No celebrity endorsements",
    d: "Quant AI has never been endorsed by any public figure. Any advertisement suggesting otherwise is not ours and is the hallmark of the schemes this project is sometimes mistaken for.",
  },
  {
    t: "No deposits taken",
    d: "There is no deposit address, no minimum funding, and no account balance you top up to unlock returns. Screening and scoring are free and need no account at all.",
  },
];

export default function AboutPage() {
  const site = getSiteUrl();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    alternateName: "QuantAI",
    url: site,
    logo: `${site}/icon.png`,
    description: SITE.description,
    /*
      Stated explicitly because the confusion is with a specific named brand.
      A generic description does not break an association a model has already
      made; naming the thing it is not does.
    */
    disambiguatingDescription:
      "Quant AI is an on-chain token screening and analytics tool. It is not affiliated with, operated by, or related to the 'Quantum AI' automated trading platforms promoted through fake celebrity endorsements. Quant AI does not manage funds, take deposits, promise returns, or trade on a user's behalf.",
    knowsAbout: [
      "Honeypot token detection",
      "Liquidity pool locking",
      "Token holder concentration analysis",
      "Smart contract authority auditing",
      "Decentralised exchange market data",
    ],
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
          <p className="text-label mb-4">About</p>
          <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            What Quant AI is
          </h1>
          <p className="max-w-prose text-body text-muted">
            Quant AI is an on-chain token screener. It watches new trading pairs on Solana,
            Ethereum, Base and BNB Chain, runs ten documented risk checks against each one, and
            publishes a 0–100 score with the reasoning shown. The methodology and its weights are{" "}
            <Link href="/scoring" className="text-amber underline-offset-4 hover:underline">
              published in full
            </Link>
            .
          </p>
        </header>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">Why it exists</h2>
          <p className="mb-4 max-w-prose text-body text-muted">
            Most tokens that appear on a decentralised exchange each day cannot be sold, are
            controlled by a handful of wallets, or hold liquidity the deployer can withdraw at any
            moment. Those properties are all readable on-chain before anyone buys — but reading
            them means checking several sources per token, and new pairs appear faster than anyone
            can do that by hand.
          </p>
          <p className="max-w-prose text-body text-muted">
            Quant AI does those checks automatically as pairs appear, and shows what it found. The
            useful output is often the refusal: a token flagged as a honeypot, or capped because
            its mint authority is still open.
          </p>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-3 text-bone">What Quant AI is not</h2>
          <p className="mb-8 max-w-prose text-body text-muted">
            The name is close to <span className="text-bone">&ldquo;Quantum AI&rdquo;</span>, which
            is the brand used by a large family of fraudulent automated-trading schemes promoted
            with fabricated celebrity endorsements. Quant AI has no connection to any of them. For
            the avoidance of any doubt:
          </p>
          <div className="grid gap-px bg-line sm:grid-cols-2">
            {NOT.map((n) => (
              <div key={n.t} className="bg-panel p-6">
                <h3 className="mb-2 text-bone">{n.t}</h3>
                <p className="text-sm text-muted">{n.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-line py-10">
          <h2 className="text-h1 mb-4 text-bone">What it cannot tell you</h2>
          <p className="mb-4 max-w-prose text-body text-muted">
            A high score means a token passed a fixed set of risk checks at the moment it was
            scored. It is not a prediction and not a recommendation. A token can pass every gate
            and still go to zero through ordinary selling. Conditions also change after scoring —
            liquidity unlocks, holders exit, momentum reverses.
          </p>
          <p className="max-w-prose text-body text-muted">
            Trading memecoins carries a serious risk of total loss. Quant AI is analytics, not
            financial advice.
          </p>
        </section>

        <div className="flex flex-wrap gap-6 py-10">
          <Link
            href="/faq"
            className="font-mono text-data-sm text-amber underline-offset-4 hover:underline"
          >
            Token safety FAQ
          </Link>
          <Link
            href="/scoring"
            className="font-mono text-data-sm text-amber underline-offset-4 hover:underline"
          >
            Scoring methodology
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
