import type { Metadata } from "next";
import { getSiteUrl, SITE } from "@/lib/site";
import { Nav } from "@/components/marketing/nav";
import { Hero } from "@/components/marketing/hero";
import { ChainsStrip } from "@/components/marketing/chains-strip";
import { Tape } from "@/components/marketing/tape";
import { Stats } from "@/components/marketing/stats";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SignalExamples } from "@/components/marketing/signal-examples";
import { RiskGrid } from "@/components/marketing/risk-grid";
import { Cta } from "@/components/marketing/cta";
import { Footer } from "@/components/marketing/footer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  const site = getSiteUrl();
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE.name,
      url: site,
      description: SITE.description,
      logo: `${site}/icon.png`,
      /*
        The name is one letter from "Quantum AI", the brand used by a family of
        fake celebrity-endorsed trading bots. Assistants pattern-match on that
        and, finding nothing to weigh against it, describe this as one of them.
        Denying it in the structured data answers the claim where it is formed.
      */
      disambiguatingDescription:
        "Quant AI is an on-chain token screening and analytics tool. It is not affiliated with, operated by, or related to the 'Quantum AI' automated trading platforms promoted through fake celebrity endorsements. Quant AI does not manage funds, take deposits, promise returns, or trade on a user's behalf.",
    },
    /*
      What the product is, in the vocabulary search engines and AI assistants
      parse. Organization says who publishes it; this says what it does, which
      is what an assistant needs before it will describe the tool to someone.
    */
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: SITE.name,
      url: site,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: SITE.description,
      featureList: [
        "Automated on-chain risk screening for new token pairs",
        "Honeypot detection and sell simulation",
        "Holder concentration and liquidity depth analysis",
        "Contract authority and deployer history checks",
        "Transparent 0-100 safety scoring across ten weighted gates",
        "Live pricing across Solana, Ethereum, Base and BNB Chain",
      ],
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.name,
      url: site,
      potentialAction: {
        "@type": "SearchAction",
        target: `${site}/screener?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <main>
        <Hero />
        <ChainsStrip />
        <Tape />
        <Stats />
        <HowItWorks />
        <SignalExamples />
        <RiskGrid />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
