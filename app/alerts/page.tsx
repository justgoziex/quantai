import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { AlertsClient } from "./alerts-client";

export const metadata: Metadata = {
  alternates: { canonical: "/alerts" },
  title: "Alerts",
  description:
    "Route Quant AI entry and exit signals to Telegram, Discord, or in-app — scored callouts for new Solana, Ethereum and BNB Chain pairs, delivered the moment they fire.",
};

export default function AlertsPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Alert center</p>
          <h1 className="text-display-lg text-bone">Hear it before the chart shows it</h1>
        </header>
        <div className="pt-10">
          <AlertsClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
