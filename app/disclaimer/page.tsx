import type { Metadata } from "next";
import { DocPage, DocSection } from "@/components/marketing/page-shell";

export const metadata: Metadata = { title: "Disclaimer" };

export default function DisclaimerPage() {
  return (
    <DocPage label="Legal" title="Disclaimer" updated="July 5, 2026">
      <DocSection title="Analytics, not advice">
        <p>
          Everything Quant AI produces — signal scores, entry and exit callouts,
          risk badges, launch readings — is an <strong>informational reading of
          public on-chain data</strong> computed by documented rules. Nothing on
          this platform is financial, investment, legal, or tax advice, and
          nothing is an offer or recommendation to buy or sell any asset.
        </p>
      </DocSection>
      <DocSection title="Scores describe structure, not the future">
        <p>
          A score of 82 means a token&rsquo;s on-chain structure passed our
          gates at that moment: liquidity was locked, the contract was verified,
          holders were distributed, momentum was positive. It does not mean the
          price will rise. Structure can change in one block — locks expire,
          holders concentrate, deployers act.
        </p>
      </DocSection>
      <DocSection title="Memecoin risk is total">
        <p>
          Memecoins routinely lose 100% of their value. Rug pulls, honeypots,
          and coordinated dumps happen despite every screening system in
          existence, including ours. Our gates reduce exposure to known
          patterns; they cannot eliminate fraud or market risk.
        </p>
      </DocSection>
      <DocSection title="Launched tokens are their creators' responsibility">
        <p>
          The token launcher is a deployment tool. A high launch reading means
          the configuration follows practices traders check for — it is not an
          endorsement of the project, its team, or its prospects by Quant AI.
        </p>
      </DocSection>
      <DocSection title="Do your own research">
        <p>
          Read the reasoning behind every signal — we publish it in plain
          English precisely so you can disagree with it. Verify contracts
          yourself. Size positions assuming total loss. If a decision depends on
          money you can&rsquo;t lose, don&rsquo;t make it here.
        </p>
      </DocSection>
    </DocPage>
  );
}
