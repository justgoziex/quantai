import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { DevClient } from "./dev-client";
import { getLocale, tt } from "@/lib/i18n-server";

export const metadata: Metadata = {
  alternates: { canonical: "/developers" },
  title: "Developer portal",
  description:
    "List your token on Quant AI. Connect the wallet you deployed from, prove ownership with a signature, and get your project screened, scored, and tradeable.",
};

export default async function DevelopersPage() {
  const locale = await getLocale();
  const T = (s: string) => tt(locale, s);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">{T("Developers")}</p>
          <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
            {T("Get your token in front of traders")}
          </h1>
          <Link
            href="/developers/docs"
            className="font-mono text-data-sm text-amber underline-offset-4 hover:underline"
          >
            {T("Docs")}
          </Link>
        </header>

        <div className="pt-8">
          <DevClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
