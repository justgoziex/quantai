import type { Metadata } from "next";
import { DocPage, DocSection } from "@/components/marketing/page-shell";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <DocPage label="Legal" title="Terms of Service" updated="July 5, 2026">
      <DocSection title="1. What Quant AI is">
        <p>
          Quant AI is an analytics and tooling platform for tokens on Ethereum
          and BNB Smart Chain. It screens newly created trading pairs, computes
          rule-based signal scores, delivers alerts, and provides a token
          deployment tool built on audited contract templates.
        </p>
        <p>
          <strong>Quant AI is not a broker, exchange, investment adviser, or
          fiduciary.</strong> Scores and signals are informational readings
          computed from public on-chain data. They are not financial advice and
          never a guarantee of any outcome.
        </p>
      </DocSection>
      <DocSection title="2. Eligibility and accounts">
        <p>
          You must be of legal age in your jurisdiction and permitted by local
          law to use crypto-asset services. One account per person; accounts are
          bound to a verified email address. We may suspend accounts that abuse
          referral systems, automate access against our rate limits, or attempt
          to manipulate scores.
        </p>
      </DocSection>
      <DocSection title="3. Wallets and custody">
        <p>
          Signing in provisions an embedded self-custodial wallet. Private keys
          are generated and secured by our wallet infrastructure provider using
          key-splitting; <strong>Quant AI servers never hold or transmit your
          raw private keys</strong> and cannot move funds on your behalf.
        </p>
      </DocSection>
      <DocSection title="4. Token launcher">
        <p>
          The launcher deploys ERC-20/BEP-20 contracts from published, audited
          templates. You are solely responsible for the tokens you create — for
          their legality in your jurisdiction, their economics, and any
          representations you make about them. Deploy fees and network gas are
          non-refundable once a transaction is broadcast.
        </p>
      </DocSection>
      <DocSection title="5. Prohibited use">
        <p>
          You may not use Quant AI to launch tokens intended to defraud; to
          manipulate scores or referral rewards through coordinated accounts; to
          scrape or resell platform data; or to violate sanctions or applicable
          law.
        </p>
      </DocSection>
      <DocSection title="6. Risk">
        <p>
          Memecoins are among the highest-risk assets that exist. Prices can go
          to zero in minutes. A high signal score describes on-chain structure
          at a point in time — it does not predict price. Never commit funds you
          cannot afford to lose entirely.
        </p>
      </DocSection>
      <DocSection title="7. Liability">
        <p>
          The service is provided as-is. To the maximum extent permitted by law,
          Quant AI&rsquo;s aggregate liability for any claim is limited to the
          fees you paid us in the twelve months preceding it. We are not liable
          for losses arising from trading decisions, network congestion, chain
          reorganizations, or third-party data outages.
        </p>
      </DocSection>
      <DocSection title="8. Changes">
        <p>
          We may update these terms; material changes are announced in-app at
          least 14 days before they take effect. Continued use after that date
          is acceptance.
        </p>
      </DocSection>
    </DocPage>
  );
}
