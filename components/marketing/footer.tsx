import Link from "next/link";
import { Lockup } from "@/components/brand/logo";
import { EthLogo, BnbLogo, RhLogo, SolLogo, BaseLogo } from "@/components/brand/chain-logo";

const COLS = [
  {
    h: "Product",
    links: [
      { t: "Screener", href: "/screener" },
      { t: "Launch a token", href: "/launch" },
      { t: "Signals", href: "/signals" },
      { t: "Alerts", href: "/alerts" },
      { t: "Portfolio", href: "/portfolio" },
      { t: "Rewards", href: "/rewards" },
      { t: "Developers", href: "/developers" },
      { t: "Listing docs", href: "/developers/docs" },
    ],
  },
  {
    h: "Resources",
    links: [
      { t: "About Quant AI", href: "/about" },
      { t: "How scoring works", href: "/scoring" },
      { t: "Token safety FAQ", href: "/faq" },
      { t: "Status", href: "/status" },
    ],
  },
  {
    h: "Legal",
    links: [
      { t: "Terms", href: "/terms" },
      { t: "Privacy", href: "/privacy" },
      { t: "Disclaimer", href: "/disclaimer" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto grid max-w-wrap gap-10 px-6 py-14 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <Lockup markSize={24} />
          <p className="mt-4 max-w-xs text-xs text-muted">
            Signal-grade screening and token launching on Ethereum and BNB
            Chain. Built for speed, honest about risk.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <EthLogo size={14} brand />
              <span className="font-mono text-data-sm text-muted">Ethereum</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <BnbLogo size={14} brand />
              <span className="font-mono text-data-sm text-muted">BNB Chain</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <BaseLogo size={14} brand />
              <span className="font-mono text-data-sm text-muted">Base</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <RhLogo size={14} brand />
              <span className="font-mono text-data-sm text-muted">Robinhood</span>
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <SolLogo size={14} brand />
              <span className="font-mono text-data-sm text-muted">Solana</span>
            </span>
          </div>
        </div>
        {COLS.map((c) => (
          <nav key={c.h} aria-label={c.h}>
            <p className="text-label mb-4">{c.h}</p>
            <ul className="flex flex-col gap-2.5">
              {c.links.map((l) => (
                <li key={l.t}>
                  <Link
                    href={l.href}
                    className="rounded text-sm text-muted transition-colors duration-fast hover:text-bone"
                  >
                    {l.t}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div
          id="disclaimer"
          className="mx-auto flex max-w-wrap flex-col gap-3 px-6 py-6 text-xs text-faint"
        >
          <p className="max-w-3xl">
            Quant AI is an analytics tool. Scores and signals are informational
            readings computed from public on-chain data — not financial advice
            and not guarantees.
          </p>
          <p className="font-mono text-data-sm">© 2026 Quant AI</p>
        </div>
      </div>
    </footer>
  );
}
