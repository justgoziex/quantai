import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { AccountClient } from "./account-client";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-12">
          <p className="text-label mb-4">Account</p>
          <h1 className="text-display-lg text-bone">Your account</h1>
        </header>
        <div className="pt-10">
          <AccountClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
