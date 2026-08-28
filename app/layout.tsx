import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import { getSiteUrl, SITE } from "@/lib/site";
import { getLocale } from "@/lib/i18n-server";
import "./globals.css";
import { LaunchBanner } from "@/components/product/launch-banner";

const geist = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const siteUrl = getSiteUrl();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0A08",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Quant AI — Signal-grade token screening on Solana, Ethereum & BNB Chain",
    template: "%s · Quant AI",
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "memecoin screener",
    "Ethereum tokens",
    "BNB Chain tokens",
    "Solana tokens",
    "Solana memecoins",
    "pump.fun screener",
    "crypto screener",
    "honeypot check",
    "token safety",
    "DEX new pairs",
    "Uniswap",
    "PancakeSwap",
    "token launch",
  ],
  authors: [{ name: SITE.name }],
  creator: SITE.name,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: "Quant AI — Signal-grade token screening on Solana, Ethereum & BNB Chain",
    description: SITE.description,
    url: siteUrl,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: SITE.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quant AI — Signal-grade token screening",
    description: SITE.description,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        {/* warm up the auth + wallet origins so sign-in/connect skips the
            TLS handshake (preconnect is body-ok per spec) */}
        <link rel="preconnect" href="https://auth.privy.io" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://auth.privy.io" />
        <link rel="preconnect" href="https://accounts.google.com" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        <Providers locale={locale}>
          {children}
          {/* one-time Solana launch announcement */}
          <LaunchBanner />
        </Providers>
      </body>
    </html>
  );
}
