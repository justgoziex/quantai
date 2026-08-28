import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { LaunchWizard } from "@/components/launch/launch-wizard";
import { RequireAuth } from "@/components/auth/require-auth";
import { getMonetization } from "@/lib/config";

export const metadata: Metadata = {
  alternates: { canonical: "/launch" },
  title: "Launch a token",
  description:
    "Audited template. LP lock, revoked mint, verified source.",
};

export default async function LaunchPage() {
  const monetization = await getMonetization();
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Token launcher · Ethereum · BNB Chain · Solana</p>
          <h1 className="text-display-lg text-bone" style={{ textWrap: "balance" }}>
            Launch a token that passes its own screening
          </h1>
        </header>
        <div className="pt-10">
          <RequireAuth
            label="Token launcher"
            title="Sign in to launch"
            description="Your wallet is the deployer."
          >
            <LaunchWizard
              launchFeeEth={monetization.launchFeeEth}
              launchFeeBnb={monetization.launchFeeBnb}
              feeWallet={monetization.feeWallet}
            />
          </RequireAuth>
        </div>
      </main>
      <Footer />
    </>
  );
}
