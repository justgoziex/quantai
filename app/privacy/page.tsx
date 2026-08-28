import type { Metadata } from "next";
import { DocPage, DocSection } from "@/components/marketing/page-shell";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <DocPage label="Legal" title="Privacy Policy" updated="July 5, 2026">
      <DocSection title="What we collect">
        <p>
          <strong>Account:</strong> your email address (via Google sign-in) and
          the public address of your embedded wallet. We never see your private
          keys.
        </p>
        <p>
          <strong>Anti-abuse:</strong> a device fingerprint and IP-derived
          region, used only to enforce one-account-per-person on referrals and
          rewards.
        </p>
        <p>
          <strong>Usage:</strong> which screens you view, filters you set, and
          alerts you configure — used to run and improve the product.
        </p>
      </DocSection>
      <DocSection title="What we don't do">
        <p>
          We do not sell your data. We do not run third-party advertising
          trackers. We do not link your wallet activity to your identity for any
          purpose beyond showing you your own portfolio.
        </p>
      </DocSection>
      <DocSection title="Who touches data on our behalf">
        <p>
          Our sign-in and embedded-wallet infrastructure (key management), the
          on-chain RPC and market-data services that power the screener (they
          receive token queries, not your identity), and our hosting provider.
          Each processes only what its function requires.
        </p>
      </DocSection>
      <DocSection title="Alerts you connect">
        <p>
          If you connect Telegram or Discord webhooks, we store the webhook
          endpoint and send it only the alerts you configured. Disconnect at any
          time in notification settings and the endpoint is deleted.
        </p>
      </DocSection>
      <DocSection title="Retention and deletion">
        <p>
          Account data is kept while the account is active. Deleting your
          account removes personal data within 30 days; on-chain data is public
          and permanent by nature and cannot be deleted by us. Email
          privacy@quantai.example to exercise access or deletion rights.
        </p>
      </DocSection>
    </DocPage>
  );
}
