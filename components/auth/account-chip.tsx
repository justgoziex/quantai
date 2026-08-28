"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

/*
  Nav account area. Three states:
  - unconfigured: link to /signin (which explains setup)
  - signed out:   "Sign in" + primary CTA
  - signed in:    address chip with account menu
*/
export function AccountChip() {
  const { ready, authenticated, email, walletAddress, solanaAddress, logout, getToken } = useAuth();
  const [copied, setCopied] = useState<"evm" | "sol" | null>(null);
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) {
      setIsAdmin(false);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch("/api/me", { headers: { authorization: `Bearer ${token}` } });
        if (r.ok) setIsAdmin((await r.json()).role === "ADMIN");
      } catch {
        /* non-blocking */
      }
    })();
  }, [ready, authenticated, getToken]);

  if (!ready) {
    return <span className="h-8 w-24 animate-skeleton-pulse rounded bg-raised" aria-hidden="true" />;
  }

  if (!authenticated) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/signin">Sign in</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/screener">Launch screener</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          A profile mark, not an address. The truncated hex said nothing a
          person could use — you can't verify a wallet from four characters,
          and both addresses are one click away in the menu below.
        */}
        <button
          className="relative flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition-colors duration-fast hover:border-line-strong hover:bg-raised hover:text-bone"
          aria-label="Account menu"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none">
            <circle cx="10" cy="6.75" r="3.25" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3.75 17c0-3.13 2.8-5.25 6.25-5.25S16.25 13.87 16.25 17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {/* signed-in dot, kept off the glyph itself so it stays legible */}
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-ink bg-gain" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-52 truncate normal-case tracking-normal">
          {email ?? "Account"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/*
          Named per chain. "Copy wallet address" was ambiguous the moment there
          were two, and pasting an EVM address into a Solana field fails in a
          way that looks like the site is broken.
        */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            if (!walletAddress) return;
            navigator.clipboard.writeText(walletAddress);
            setCopied("evm");
            setTimeout(() => setCopied(null), 1400);
          }}
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span>{copied === "evm" ? "Copied" : "Copy EVM address"}</span>
            <span className="font-mono text-data-sm text-faint">{shortAddress(walletAddress)}</span>
          </span>
        </DropdownMenuItem>
        {solanaAddress ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              navigator.clipboard.writeText(solanaAddress);
              setCopied("sol");
              setTimeout(() => setCopied(null), 1400);
            }}
          >
            <span className="flex w-full items-center justify-between gap-3">
              <span>{copied === "sol" ? "Copied" : "Copy Solana address"}</span>
              <span className="font-mono text-data-sm text-faint">{shortAddress(solanaAddress)}</span>
            </span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => router.push("/portfolio")}>Portfolio</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/alerts")}>Alerts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/rewards")}>Rewards</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/account")}>Account settings</DropdownMenuItem>
        {isAdmin ? (
          <DropdownMenuItem onSelect={() => router.push("/admin")}>Admin</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-loss focus:text-loss"
          onSelect={async () => {
            await logout();
            router.push("/");
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
