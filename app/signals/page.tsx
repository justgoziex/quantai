import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { SignalExamples } from "@/components/marketing/signal-examples";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  alternates: { canonical: "/signals" },
  title: "Signals",
  description:
    "Entry and exit callouts for Solana, Ethereum and BNB Chain memecoins, scored 0–100 with the reasoning in plain English.",
};

const SIGNAL_TYPES = [
  {
    badge: { variant: "amber", text: "Entry" },
    title: "Breakout entry",
    body: "Price clears a defined range on rising volume while structure holds — locked LP, spread holders, clean contract.",
  },
  {
    badge: { variant: "warn", text: "Exit" },
    title: "Momentum exit",
    body: "Buy pressure flips, early wallets rotate out, or liquidity starts leaving. Fired before the chart makes it obvious.",
  },
  {
    badge: { variant: "loss", text: "Risk" },
    title: "Structure alert",
    body: "Something changed under the price: LP unlock approaching, holder concentration spiking, taxes raised, owner acting.",
  },
] as const;

const CHANNELS = [
  { name: "In-app alert center", state: "Live with your account" },
  { name: "Telegram", state: "Connects when live data ships" },
  { name: "Discord webhook", state: "Connects when live data ships" },
];

export default function SignalsPage() {
  return (
    <>
      <Nav />
      <main>
        <header className="border-b border-line">
          <div className="mx-auto max-w-wrap px-6 py-12">
            <p className="text-label mb-4">Signals</p>
            <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
              Three kinds of callout, one standard of proof
            </h1>
            <p className="max-w-2xl text-base text-muted">
              Every signal carries its score, the gates behind it, and the
              reasoning in plain English — so you can disagree with it.
            </p>
          </div>
        </header>

        <section className="border-b border-line">
          <div className="mx-auto grid max-w-wrap sm:grid-cols-3">
            {SIGNAL_TYPES.map((s, i) => (
              <div
                key={s.title}
                className={"px-6 py-8 " + (i > 0 ? "border-t border-line sm:border-l sm:border-t-0" : "")}
              >
                <Badge variant={s.badge.variant} className="mb-3">
                  {s.badge.text}
                </Badge>
                <h2 className="text-h2 mb-2 text-bone">{s.title}</h2>
                <p className="text-sm text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <SignalExamples />

        <section className="border-b border-line">
          <div className="mx-auto max-w-wrap px-6 py-16">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-label mb-3">Delivery</p>
                <h2 className="text-display-lg text-bone">Where signals reach you</h2>
              </div>
              <Button asChild>
                <Link href="/alerts">Open alert center</Link>
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border border-line">
              {CHANNELS.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between border-b border-line bg-panel px-5 py-4 last:border-0"
                >
                  <span className="text-sm text-bone">{c.name}</span>
                  <span className="font-mono text-data-sm text-muted">{c.state}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
