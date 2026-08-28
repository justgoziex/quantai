"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChainLogo } from "@/components/brand/chain-logo";
import { useI18n } from "@/lib/i18n";
import { usdCompact } from "@/lib/format";
import { priceFmt } from "@/lib/mock-series";
import { cn } from "@/lib/utils";

/*
  Promoted-token banner (DexScreener-style). Paid ad slots rotate every few
  seconds across the screener and token pages. Always labelled "Ad" so it's
  never mistaken for an organic signal — the score shown is still the real
  Quant AI score, so a paid slot can't hide a bad token.
*/
type Ad = {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  headline: string | null;
  ctaUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  score: number | null;
  liquidityUsd: number | null;
};

const ROTATE_MS = 7000;

export function AdBanner({ className }: { className?: string }) {
  const { t } = useI18n();
  const [ads, setAds] = useState<Ad[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads")
      .then((r) => r.json())
      .then((d) => alive && setAds(d.ads ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ads.length < 2) return;
    const timer = setInterval(() => setI((n) => (n + 1) % ads.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [ads.length]);

  const ad = ads[i];

  // count an impression when a slot becomes visible
  useEffect(() => {
    if (!ad) return;
    fetch("/api/ads/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ad.id, kind: "impression" }),
    }).catch(() => {});
  }, [ad?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = useCallback(() => {
    if (!ad) return;
    fetch("/api/ads/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ad.id, kind: "click" }),
    }).catch(() => {});
  }, [ad]);

  if (!ad) return null;

  const href = ad.ctaUrl || `/token/${ad.chain.toLowerCase()}/${ad.address}`;
  const external = Boolean(ad.ctaUrl);
  const up = (ad.change24h ?? 0) >= 0;

  const inner = (
    <>
      <span className="flex shrink-0 items-center gap-1.5 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-data-sm uppercase tracking-[0.1em] text-amber">
        {t("Ad")}
      </span>
      <ChainLogo chain={ad.chain} size={16} />
      <span className="truncate text-sm font-medium text-bone">{ad.symbol}</span>
      {ad.headline ? (
        <span className="hidden truncate text-sm text-muted sm:inline">{ad.headline}</span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-data-sm">
        {ad.priceUsd != null ? <span className="text-bone">{priceFmt(ad.priceUsd)}</span> : null}
        {ad.change24h != null ? (
          <span className={up ? "text-gain" : "text-loss"}>
            {up ? "+" : ""}
            {ad.change24h.toFixed(1)}%
          </span>
        ) : null}
        {ad.liquidityUsd != null ? (
          <span className="hidden text-muted md:inline">{usdCompact(ad.liquidityUsd)}</span>
        ) : null}
        {ad.score != null ? (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 tabular",
              ad.score >= 70 ? "text-gain" : ad.score >= 40 ? "text-warn" : "text-loss",
            )}
            title="Quant AI score"
          >
            {ad.score}
          </span>
        ) : null}
      </span>
    </>
  );

  const cls = cn(
    "flex items-center gap-3 rounded-md border border-line bg-panel px-4 py-2.5 transition-colors duration-fast hover:border-line-strong",
    className,
  );

  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer sponsored" onClick={onClick} className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} onClick={onClick} className={cls}>
      {inner}
    </Link>
  );
}
