"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/*
  Display-currency preference for balances. Values are computed in USD on the
  server; this converts them for display into the user's chosen unit — USDT
  (≈ USD), ETH, BNB, or SOL — using live native prices. Persisted in localStorage.
*/
export type Currency = "usdt" | "eth" | "bnb" | "sol";
export const CURRENCIES: { v: Currency; label: string }[] = [
  { v: "usdt", label: "USDT" },
  { v: "eth", label: "ETH" },
  { v: "bnb", label: "BNB" },
  { v: "sol", label: "SOL" },
];

type CurrencyValue = {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /* format a USD amount into the chosen currency, given live native prices */
  fmt: (usd: number, nativeUsd?: { eth: number; bnb: number; sol?: number }) => string;
};

const CurrencyContext = createContext<CurrencyValue>({
  currency: "usdt",
  setCurrency: () => {},
  fmt: (usd) => `$${usd.toFixed(2)}`,
});

/*
  Compact, fixed-length output so the balance chip never changes width:
  big numbers abbreviate (12.4K), small ones keep useful precision.
*/
function short(v: number, maxDp: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: maxDp });
}

function format(
  currency: Currency,
  usd: number,
  nativeUsd?: { eth: number; bnb: number; sol?: number },
): string {
  if (currency === "eth" || currency === "bnb" || currency === "sol") {
    const p =
      (currency === "eth" ? nativeUsd?.eth : currency === "bnb" ? nativeUsd?.bnb : nativeUsd?.sol) ?? 0;
    // price feed unavailable → say so rather than showing a false 0
    if (!(p > 0)) return `— ${currency.toUpperCase()}`;
    return `${short(usd / p, 4)} ${currency.toUpperCase()}`;
  }
  return `${short(usd, 2)} USDT`;
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("usdt");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("quantai:currency") as Currency | null;
      if (saved && ["usdt", "eth", "bnb", "sol"].includes(saved)) setCurrencyState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem("quantai:currency", c);
    } catch {
      /* ignore */
    }
  }, []);

  const fmt = useCallback(
    (usd: number, nativeUsd?: { eth: number; bnb: number; sol?: number }) =>
      format(currency, usd, nativeUsd),
    [currency],
  );

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, fmt }}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
