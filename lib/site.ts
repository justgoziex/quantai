/*
  Canonical site origin, used for metadataBase, canonical URLs, sitemap and
  robots. Set NEXT_PUBLIC_SITE_URL to the production domain once you have one;
  otherwise we fall back to the Vercel-provided URL, then localhost for dev.
*/
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3311";
}

export const SITE = {
  name: "Quant AI",
  tagline: "Signal-grade token screening on Solana, Ethereum, Base & BNB Chain",
  description:
    "Quant AI screens memecoins on Solana, Ethereum, Base and BNB Chain, running ten on-chain risk gates — honeypot detection, sell simulation, holder concentration, liquidity depth and contract authority — into a transparent 0–100 score. Analytics, not financial advice.",
} as const;
