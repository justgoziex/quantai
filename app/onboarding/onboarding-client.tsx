"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mark } from "@/components/brand/logo";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";

/*
  First-run onboarding: confirm the wallet exists, hand over the address,
  point at the three things you can do. Completes to localStorage until the
  database phase gives it a server home.
*/
const NEXT_STEPS = [
  { href: "/screener", title: "Open the screener", body: "Live pairs on Ethereum and BNB Chain, scored as they land." },
  { href: "/launch", title: "Launch a token", body: "Deploy from an audited template and see its reading first." },
  { href: "/rewards", title: "Grab your referral code", body: "Fee share starts at your first referral." },
] as const;

export function OnboardingClient() {
  const { configured, ready, authenticated, email, walletAddress, logout } = useAuth();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (ready && (!configured || !authenticated)) router.replace("/signin");
  }, [ready, configured, authenticated, router]);

  useEffect(() => {
    if (authenticated) localStorage.setItem("quantai:onboarded", "1");
  }, [authenticated]);

  if (!ready || !authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Mark size={40} className="animate-skeleton-pulse text-faint" tailClassName="text-faint" />
      </main>
    );
  }

  const copy = async () => {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
      >
        <Mark size={36} className="mb-8 text-bone" />
        <p className="text-label mb-3">Account ready</p>
        <h1 className="text-display-lg mb-3 text-bone" style={{ textWrap: "balance" }}>
          Your desk is set up
        </h1>
        <p className="mb-8 text-base text-muted">
          Signed in as <span className="text-bone">{email ?? "your account"}</span>.
          Your wallet is ready — one address, both chains.
        </p>

        <div className="mb-8 rounded-md border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-label">Wallet · ETH + BSC</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <span className="font-mono text-data text-bone" title={walletAddress ?? undefined}>
              {walletAddress ? shortAddress(walletAddress) : "Provisioning…"}
            </span>
            <Button variant="secondary" size="sm" onClick={copy} disabled={!walletAddress}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
        </div>

        <div className="mb-10 flex flex-col gap-2.5">
          {NEXT_STEPS.map((s, i) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex items-center justify-between rounded-md border border-line bg-panel px-4 py-3.5 transition-colors duration-fast hover:border-line-strong hover:bg-raised"
            >
              <span className="flex items-center gap-4">
                <span className="font-mono text-data-sm text-faint transition-colors duration-fast group-hover:text-amber">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="block text-sm font-medium text-bone">{s.title}</span>
                  <span className="block text-xs text-muted">{s.body}</span>
                </span>
              </span>
              <span className="text-muted transition-transform duration-fast group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button asChild size="lg">
            <Link href="/screener">Start screening</Link>
          </Button>
          <button
            onClick={() => logout()}
            className="rounded text-xs text-faint underline-offset-4 hover:text-muted hover:underline"
          >
            Sign out
          </button>
        </div>
      </motion.div>
    </main>
  );
}
