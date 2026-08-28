import { cn } from "@/lib/utils";

/*
  Chain marks — Ethereum diamond and BNB Chain diamond, drawn as flat SVG.
  Monochrome by default (inherits currentColor) so they sit in the terminal
  palette; pass `brand` to show the real chain colors.
*/
export function EthLogo({ size = 16, className, brand = false }: { size?: number; className?: string; brand?: boolean }) {
  return (
    <svg viewBox="0 0 256 417" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label="Ethereum">
      <g fill="currentColor">
        <path d="M127.9 0L125.2 9.5v275.7l2.7 2.7 127.9-75.6z" opacity={brand ? 0.6 : 0.55} fill={brand ? "#8A92B2" : "currentColor"} />
        <path d="M127.9 0L0 212.3l127.9 75.6V154.2z" fill={brand ? "#62688F" : "currentColor"} opacity={brand ? 1 : 0.85} />
        <path d="M127.9 312.2l-1.5 1.9v98.2l1.5 4.5L256 236.6z" opacity={brand ? 0.6 : 0.55} fill={brand ? "#8A92B2" : "currentColor"} />
        <path d="M127.9 417.3v-105L0 236.6z" fill={brand ? "#62688F" : "currentColor"} opacity={brand ? 1 : 0.85} />
        <path d="M127.9 287.9l127.9-75.6-127.9-58.1z" opacity={brand ? 0.2 : 0.4} fill={brand ? "#454A75" : "currentColor"} />
        <path d="M0 212.3l127.9 75.6V154.2z" opacity={brand ? 0.6 : 0.7} fill={brand ? "#62688F" : "currentColor"} />
      </g>
    </svg>
  );
}

export function BnbLogo({ size = 16, className, brand = false }: { size?: number; className?: string; brand?: boolean }) {
  const fill = brand ? "#F3BA2F" : "currentColor";
  return (
    <svg viewBox="0 0 126 126" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label="BNB Chain">
      <path
        fill={fill}
        d="M38.7 53.2L63 28.9l24.3 24.3 14.1-14.1L63 0.7 24.6 39.1zM0.7 63l14.1-14.1L28.9 63 14.8 77.1zM38.7 72.8L63 97.1l24.3-24.3 14.1 14L63 125.3 24.6 86.9zM97.1 63l14.1-14.1L125.3 63l-14.1 14.1zM77.3 63L63 48.6 52.4 59.2l-1.2 1.2-2.5 2.5 14.3 14.3z"
      />
    </svg>
  );
}

/*
  Robinhood Chain mark — a stylized feather (Robinhood's motif) drawn as a
  single flat blade with a spine. Brand green on dark, currentColor otherwise.
*/
export function RhLogo({ size = 16, className, brand = false }: { size?: number; className?: string; brand?: boolean }) {
  const fill = brand ? "#0BD50B" : "currentColor";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label="Robinhood Chain">
      {/* feather blade */}
      <path
        fill={fill}
        d="M20 3.5c-6.2.2-10.7 2.4-13.2 6.6-1.6 2.7-2 5.9-1.9 8.9l2.9-2.9c.2-2 .8-3.9 1.9-5.5 1.9-2.8 5-4.6 9.1-5.3-3 1.6-5.2 3.6-6.7 6-.9 1.5-1.5 3.1-1.8 4.8l3.6-.0c1.9 0 3.5-1.2 4.1-3 1.1-3.4 1.4-6.9 0-9.6z"
      />
      {/* spine */}
      <path
        fill={fill}
        opacity={brand ? 0.55 : 0.5}
        d="M4.2 20.5l2.7-2.7c.5-.5 1.2-.8 1.9-.8h1.6l-4.6 4.6c-.5.5-1.3.5-1.7 0-.4-.4-.4-1.1.1-1.1z"
      />
    </svg>
  );
}

/*
  Base mark — the official Base glyph: a circle with a flat left edge.
  Brand blue on dark, currentColor otherwise.
*/
export function BaseLogo({ size = 16, className, brand = false }: { size?: number; className?: string; brand?: boolean }) {
  const fill = brand ? "#0052FF" : "currentColor";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label="Base">
      <path
        fill={fill}
        d="M11.9 22c5.6 0 10.1-4.5 10.1-10S17.5 2 11.9 2C6.6 2 2.3 6 1.9 11.1h13.4v1.8H1.9C2.3 18 6.6 22 11.9 22z"
      />
    </svg>
  );
}


/*
  Solana — the three-bar mark. Brand gradient on dark, currentColor otherwise
  so it still reads inside monochrome rows.
*/
export function SolLogo({ size = 16, className, brand = false }: { size?: number; className?: string; brand?: boolean }) {
  const id = "solGrad";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label="Solana">
      {brand ? (
        <defs>
          <linearGradient id={id} x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9945FF" />
            <stop offset="100%" stopColor="#14F195" />
          </linearGradient>
        </defs>
      ) : null}
      <g fill={brand ? `url(#${id})` : "currentColor"}>
        <path d="M5.4 16.9a.7.7 0 0 1 .5-.2h14.4c.3 0 .5.4.3.7l-2.9 2.9a.7.7 0 0 1-.5.2H2.8c-.3 0-.5-.4-.3-.7l2.9-2.9Z" />
        <path d="M5.4 3.5a.7.7 0 0 1 .5-.2h14.4c.3 0 .5.4.3.7l-2.9 2.9a.7.7 0 0 1-.5.2H2.8c-.3 0-.5-.4-.3-.7l2.9-2.9Z" />
        <path d="M18.1 10.2a.7.7 0 0 0-.5-.2H3.2c-.3 0-.5.4-.3.7l2.9 2.9c.1.1.3.2.5.2h14.4c.3 0 .5-.4.3-.7l-2.9-2.9Z" />
      </g>
    </svg>
  );
}

export function ChainLogo({
  chain,
  size = 16,
  className,
  brand = true,
}: {
  chain: string;
  size?: number;
  className?: string;
  brand?: boolean;
}) {
  const c = chain.toUpperCase();
  if (c === "BSC") return <BnbLogo size={size} className={className} brand={brand} />;
  if (c === "BASE") return <BaseLogo size={size} className={className} brand={brand} />;
  if (c === "RH") return <RhLogo size={size} className={className} brand={brand} />;
  if (c === "SOL") return <SolLogo size={size} className={className} brand={brand} />;
  return <EthLogo size={size} className={className} brand={brand} />;
}
