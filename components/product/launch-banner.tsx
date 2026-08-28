"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SolLogo } from "@/components/brand/chain-logo";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";

/*
  Solana launch announcement.

  A modal earns its interruption only for something a user genuinely needs to
  notice — a whole new chain qualifies, a small change would not. So it shows
  ONCE per person, ever: dismissing writes a flag and it never returns.
  Nagging is what teaches people to close things unread.

  Two exits (the ×, and "Not now"), plus Escape and a click outside. It waits
  for auth to resolve so it can't flash at a signed-out visitor, and waits a
  beat after mount so it doesn't fight the first paint.
*/
const SEEN_KEY = "quantai-solana-launch-seen";

export function LaunchBanner() {
  const { ready, authenticated } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — it just shows again next visit */
    }
  }, []);

  useEffect(() => {
    /*
      ?solanaLaunch=1 forces it open regardless of auth or the seen flag, so
      the desk can check the real thing on production without signing out.
    */
    const forced =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("solanaLaunch") === "1";
    if (forced) {
      setOpen(true);
      return;
    }
    if (!ready || !authenticated) return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;

    // the desk can retire the launch for everyone at once
    let cancelled = false;
    const timer = setTimeout(async () => {
      const live = await fetch("/api/launch-banner")
        .then((r) => r.json())
        .then((d) => d?.enabled === true)
        .catch(() => false);
      if (live && !cancelled) setOpen(true);
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, authenticated]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/75 p-4 backdrop-blur-sm motion-safe:animate-in"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="solana-launch-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[430px] rounded-lg border border-line-strong bg-panel px-6 pb-6 pt-7 text-center shadow-2xl"
      >
        <button
          onClick={dismiss}
          aria-label={t("Dismiss")}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded border border-line text-faint transition-colors duration-fast hover:border-line-strong hover:text-bone"
        >
          <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        {/* Solana's own colours carry the announcement, not the Quant amber —
            this is about the chain, and the halo keeps it from shouting. */}
        <div
          className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full border"
          style={{
            borderColor: "rgba(153,69,255,0.4)",
            background: "radial-gradient(circle at 50% 50%, rgba(153,69,255,0.28), transparent 70%)",
          }}
        >
          <SolLogo size={22} brand />
        </div>

        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#14f195]">
          {t("Now live")}
        </p>
        <h2 id="solana-launch-title" className="mb-2 text-h1 text-bone">
          {t("Solana is on Quant AI")}
        </h2>
        <p className="mb-5 text-sm text-muted">
          {t(
            "Every new Solana pair, scored 0–100 by the same ten gates — mint authority, freeze authority, holders, liquidity.",
          )}
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            asChild
            onClick={dismiss}
            className="border-0 text-[#08120c] hover:opacity-90"
            style={{ background: "linear-gradient(96deg, #9945FF, #14F195)" }}
          >
            <Link href="/screener?chain=SOL">{t("Trade SOL")}</Link>
          </Button>
          <Button variant="secondary" onClick={dismiss}>
            {t("Not now")}
          </Button>
        </div>
      </div>
    </div>
  );
}
