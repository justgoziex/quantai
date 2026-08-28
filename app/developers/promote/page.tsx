import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { PromoteClient } from "./promote-client";
import { getLocale, tt } from "@/lib/i18n-server";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  alternates: { canonical: "/developers/promote" },
  title: "Promote your token",
  description: "Top of the screener and every token page.",
};

export default async function PromotePage() {
  const locale = await getLocale();
  const T = (s: string) => tt(locale, s);
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">{T("Promote")}</p>
          <h1 className="text-display-lg text-bone">{T("Put your token in the rotation")}</h1>
        </header>
        <div className="pt-8">
          <Suspense fallback={<Skeleton className="h-64 rounded-md" />}>
            <PromoteClient />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
