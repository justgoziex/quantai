import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { PnlDemoClient } from "./pnl-demo-client";

export const metadata: Metadata = { title: "PnL card demo" };

export default function PnlDemoPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-10">
          <p className="text-label mb-3">Preview</p>
          <h1 className="text-display-lg text-bone">Shareable PnL card</h1>
        </header>
        <div className="pt-8">
          <PnlDemoClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
