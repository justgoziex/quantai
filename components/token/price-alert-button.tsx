"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  Set a one-shot price alert from the token page. Above/below a target USD
  price; fires to in-app notifications and linked Telegram.
*/
export function PriceAlertButton({
  tokenId,
  priceUsd,
}: {
  tokenId: string;
  priceUsd: number | null;
}) {
  const { ready, authenticated, getToken } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [target, setTarget] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  if (!ready || !authenticated) return null;

  const save = async () => {
    const p = Number(target);
    if (!Number.isFinite(p) || p <= 0) return;
    setState("saving");
    try {
      const tok = await getToken();
      const r = await fetch("/api/alerts/price", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
        body: JSON.stringify({ tokenId, direction, priceUsd: p }),
      });
      if (!r.ok) throw new Error();
      setState("done");
      setTimeout(() => {
        setOpen(false);
        setState("idle");
        setTarget("");
      }, 1200);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path
            d="M8 2a4 4 0 0 0-4 4v2.5L2.8 10.6a.7.7 0 0 0 .55 1.15h9.3a.7.7 0 0 0 .55-1.15L12 8.5V6a4 4 0 0 0-4-4Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {t("Set alert")}
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-line bg-panel p-3 shadow-lg">
            <p className="text-label mb-2">{t("Alert me when price goes")}</p>
            <div className="mb-2 flex overflow-hidden rounded border border-line">
              {(["ABOVE", "BELOW"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  aria-pressed={direction === d}
                  className={cn(
                    "flex-1 py-1.5 font-mono text-data-sm transition-colors",
                    d === "BELOW" && "border-l border-line",
                    direction === d
                      ? d === "ABOVE"
                        ? "bg-raised text-gain"
                        : "bg-raised text-loss"
                      : "text-muted hover:text-bone",
                  )}
                >
                  {d === "ABOVE" ? `↑ ${t("Above")}` : `↓ ${t("Below")}`}
                </button>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-data text-muted">$</span>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[^0-9.eE-]/g, ""))}
                placeholder={priceUsd ? String(priceUsd) : "0.0001"}
                inputMode="decimal"
                className="font-mono text-data"
              />
            </div>
            <Button size="sm" className="w-full" onClick={save} disabled={state === "saving" || !target}>
              {state === "saving" ? "…" : state === "done" ? "✓" : t("Create alert")}
            </Button>
            {state === "error" ? (
              <p className="mt-1.5 text-xs text-loss">{t("Couldn't save — try again.")}</p>
            ) : (
              <p className="mt-1.5 text-xs text-faint">{t("Delivered in-app and to Telegram if linked.")}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
