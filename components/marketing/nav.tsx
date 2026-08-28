"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lockup } from "@/components/brand/logo";
import { EthLogo, BnbLogo, SolLogo } from "@/components/brand/chain-logo";
import { NavBalance } from "@/components/marketing/nav-balance";
import { LangSwitch } from "@/components/marketing/lang-switch";
import { AccountChip } from "@/components/auth/account-chip";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { AnnouncementBanner } from "@/components/marketing/announcement-banner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/*
  Two navs, one component. Signed out: the pitch. Signed in: the desk.
*/
const MARKETING_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/signals", label: "Signals" },
  { href: "/scoring", label: "Scoring" },
];

const APP_LINKS = [
  { href: "/screener", label: "Screener" },
  { href: "/launch", label: "Launch" },
  { href: "/alerts", label: "Alerts" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/rewards", label: "Rewards" },
  { href: "/developers", label: "Developers" },
];

export function Nav() {
  const { ready, authenticated } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const links = ready && authenticated ? APP_LINKS : MARKETING_LINKS;

  return (
    <header className="sticky top-0 z-40 bg-ink/90 backdrop-blur-sm">
      <AnnouncementBanner />
      <div className="mx-auto flex h-14 max-w-wrap items-center justify-between gap-3 border-b border-line px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="rounded" aria-label="Quant AI home">
            <Lockup markSize={24} />
          </Link>
          <span
            className="hidden items-center gap-1.5 border-l border-line pl-3 md:flex"
            title="Ethereum + BNB Chain"
          >
            <EthLogo size={15} brand />
            <BnbLogo size={15} brand />
            <SolLogo size={15} brand />
          </span>
        </div>
        <nav className="hidden items-center gap-7 text-sm text-muted sm:flex" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded transition-colors duration-fast hover:text-bone"
            >
              {t(l.label)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <NavBalance />
          <LangSwitch />
          {/* mobile menu — links live here below sm */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded border border-line p-2 text-muted transition-colors duration-fast hover:text-bone sm:hidden"
                aria-label="Open menu"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                  <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {links.map((l) => (
                <DropdownMenuItem key={l.href} onSelect={() => router.push(l.href)}>
                  {t(l.label)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <AccountChip />
        </div>
      </div>
    </header>
  );
}
