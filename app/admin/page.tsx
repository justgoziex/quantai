import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { AdminClient } from "./admin-client";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="border-b border-line py-10">
          <p className="text-label mb-3">Operations</p>
          <h1 className="text-display-lg text-bone">Admin</h1>
        </header>
        <div className="pt-8">
          <AdminClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
