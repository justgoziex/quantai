import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { RewardsClient } from "@/components/rewards/rewards-client";
import { ExternalWalletCard } from "@/components/rewards/external-wallet";
import { getWalletPolicy, getRewardSwitches, getRewardConfig } from "@/lib/config";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  alternates: { canonical: "/rewards" },
  title: "Rewards & referrals",
  description:
    "Earn ETH on Quant AI: trading cashback that scales with your volume, referral rewards, and launch bonuses. Vests over 30 days.",
};

const TIERS = [
  { name: "Scout", referrals: "1–4", share: "10%", perk: "Referral share of platform fees" },
  { name: "Operator", referrals: "5–19", share: "15%", perk: "+ priority alert delivery" },
  { name: "Desk", referrals: "20+", share: "20%", perk: "+ early access to new gates" },
];

const VOLUME_TIERS = [
  { name: "Fish", volume: "< $5K", rate: "1×", perk: "Base cashback on every trade" },
  { name: "Active", volume: "$5K+", rate: "1.25×", perk: "Warmed-up rate" },
  { name: "Runner", volume: "$25K+", rate: "1.5×", perk: "More ETH per dollar" },
  { name: "Shark", volume: "$100K+", rate: "2×", perk: "Double the base rate" },
  { name: "Whale", volume: "$500K+", rate: "2.5×", perk: "Top cashback rate" },
];

const eth = (points: number) => {
  const v = points / 1_000_000;
  return (v >= 0.01 ? v.toFixed(4) : v.toFixed(6)).replace(/\.?0+$/, "");
};

export default async function RewardsPage() {
  const [walletPolicy, switches, amounts] = await Promise.all([
    getWalletPolicy(),
    getRewardSwitches(),
    getRewardConfig(),
  ]);
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Rewards & referrals</p>
          <h1 className="text-display-lg text-bone">Bring a trader, share the desk</h1>
        </header>

        <div className="flex flex-col gap-6 pt-10">
          {switches.walletCashback ? <ExternalWalletCard policyText={walletPolicy.text} /> : null}
          <RewardsClient>
          <section className="overflow-hidden rounded-md border border-line">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-2.5 font-mono text-data-sm uppercase tracking-[0.1em] text-muted sm:grid-cols-[1fr_auto_auto_1.2fr]">
              <span>Tier</span>
              <span className="text-right">Referrals</span>
              <span className="text-right">Fee share</span>
              <span className="hidden sm:block">Includes</span>
            </div>
            {TIERS.map((t, i) => (
              <div
                key={t.name}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-4 last:border-0 sm:grid-cols-[1fr_auto_auto_1.2fr]"
              >
                <span className="flex items-center gap-3">
                  <span className="font-mono text-data-sm text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-sm font-medium text-bone">{t.name}</span>
                  {i === 2 && <Badge variant="amber">Top tier</Badge>}
                </span>
                <span className="text-right font-mono text-data text-muted">{t.referrals}</span>
                <span className="text-right font-mono text-data text-bone">{t.share}</span>
                <span className="hidden text-sm text-muted sm:block">{t.perk}</span>
              </div>
            ))}
          </section>
          <div>
            <p className="text-label mb-3">Trading cashback tiers</p>
            <section className="overflow-hidden rounded-md border border-line">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-2.5 font-mono text-data-sm uppercase tracking-[0.1em] text-muted sm:grid-cols-[1fr_auto_auto_1.2fr]">
                <span>Trader tier</span>
                <span className="text-right">Lifetime volume</span>
                <span className="text-right">Cashback rate</span>
                <span className="hidden sm:block">Perk</span>
              </div>
              {VOLUME_TIERS.map((t, i) => (
                <div
                  key={t.name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-4 last:border-0 sm:grid-cols-[1fr_auto_auto_1.2fr]"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-data-sm text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm font-medium text-bone">{t.name}</span>
                    {i === VOLUME_TIERS.length - 1 && <Badge variant="amber">Top tier</Badge>}
                  </span>
                  <span className="text-right font-mono text-data text-muted">{t.volume}</span>
                  <span className="text-right font-mono text-data text-bone">{t.rate}</span>
                  <span className="hidden text-sm text-muted sm:block">{t.perk}</span>
                </div>
              ))}
            </section>
          </div>
          <div className="max-w-2xl text-xs text-faint">
            <p className="mb-2">
              How rewards accrue: referral qualified +{eth(amounts.referralQualified)} ETH ·
              first trade +{eth(amounts.firstTrade)} ETH · each token launch +{eth(amounts.launch)} ETH ·
              plus trading cashback in ETH on every trade, sized by its USD volume and
              your trader tier (dust trades under $10 don&apos;t earn, and each trade is
              capped to blunt wash trading).
            </p>
            <p>
              Rewards vest 30 days after they accrue. Self-referrals and account
              farms are blocked at attribution and forfeit the ledger.
            </p>
          </div>
          </RewardsClient>
        </div>
      </main>
      <Footer />
    </>
  );
}
