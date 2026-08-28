"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { useCurrency, CURRENCIES, type Currency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/*
  Spendable balance in the top bar — CASH, the way exchanges show it: buying
  reduces it, selling increases it (holdings live on the portfolio page).
  Shown in the user's chosen display currency — USDT, ETH, or BNB. Refreshes
  on an interval and immediately after any trade (quantai:balance event).
*/
export function NavBalance() {
  const { ready, authenticated, getToken } = useAuth();
  const { t } = useI18n();
  const { currency, setCurrency, fmt } = useCurrency();
  const [cashUsd, setCashUsd] = useState<number | null>(null);
  const [nativeUsd, setNativeUsd] = useState<{ eth: number; bnb: number; sol: number }>({ eth: 0, bnb: 0, sol: 0 });
  const [open, setOpen] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const tk = await getToken();
        if (!tk) return;
        const r = await fetch(`/api/balance${fresh ? "?fresh=1" : ""}`, {
          headers: { authorization: `Bearer ${tk}` },
          cache: "no-store",
        });
        if (r.ok) {
          const d = await r.json();
          setCashUsd(d.cashUsd ?? 0);
          if (d.nativeUsd) setNativeUsd(d.nativeUsd);
        }
      } catch {
        /* transient */
      }
    },
    [getToken],
  );

  useEffect(() => {
    if (!ready || !authenticated) return;
    load();
    const i = setInterval(() => load(), 30_000);
    const onTrade = () => load(true);
    window.addEventListener("quantai:balance", onTrade);
    return () => {
      clearInterval(i);
      window.removeEventListener("quantai:balance", onTrade);
    };
  }, [ready, authenticated, load]);

  if (!ready || !authenticated) return null;

  const pick = (c: Currency) => {
    setCurrency(c);
    setOpen(false);
  };

  return (
    /*
      Fixed footprint — same height and width on every device, so a long
      number can never stretch the nav. The amount truncates instead.
    */
    <div className="relative hidden sm:block">
      <div className="flex h-9 w-[184px] items-center gap-1 rounded-md border border-line bg-panel px-3">
        <Link
          href="/portfolio"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded"
          title="Available balance"
        >
          <span className="text-label shrink-0">{t("Balance")}</span>
          <span className="truncate font-mono text-data tabular text-bone">
            {cashUsd === null ? "…" : fmt(cashUsd, nativeUsd)}
          </span>
        </Link>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Change display currency"
          className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-bone"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-1 w-28 overflow-hidden rounded-md border border-line bg-panel shadow-lg">
            {CURRENCIES.map((c) => (
              <button
                key={c.v}
                onClick={() => pick(c.v)}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 font-mono text-data-sm transition-colors",
                  currency === c.v ? "bg-raised text-amber" : "text-muted hover:bg-raised hover:text-bone",
                )}
              >
                {c.label}
                {currency === c.v ? (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
