import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { PortfolioClient } from "@/components/portfolio/portfolio-client";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Portfolio</p>
          <h1 className="text-display-lg text-bone">Your positions, scored like everything else</h1>
        </header>
        <div className="pt-8">
          <PortfolioClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
