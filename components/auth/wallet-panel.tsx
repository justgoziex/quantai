"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { EmptyState } from "@/components/product/empty-state";
import { Button } from "@/components/ui/button";

/*
  Portfolio auth section: signed in → wallet identity card (balances arrive
  with the data phase); signed out → route to /signin.
*/
export function WalletPanel() {
  const { ready, authenticated, email, walletAddress } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!ready) {
    return <div className="h-40 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  if (!authenticated) {
    return (
      <EmptyState
        label="Portfolio"
        title="Sign in to open your desk"
        description="Email or Google."
        action={
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/signin">Sign in</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/launch">Launch a token</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-label">Your wallet</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-5">
        <div>
          <p className="font-mono text-data-lg text-bone" title={walletAddress ?? undefined}>
            {walletAddress ? shortAddress(walletAddress) : "Provisioning…"}
          </p>
          <p className="mt-1 text-xs text-muted">{email} · Ethereum + BNB Chain</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!walletAddress}
          onClick={async () => {
            if (!walletAddress) return;
            await navigator.clipboard.writeText(walletAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>
    </div>
  );
}
