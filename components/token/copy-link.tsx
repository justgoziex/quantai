"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

/*
  Copy the current token page link to the clipboard. Small inline control that
  sits beside "View on explorer".
*/
export function CopyLink() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      const url = typeof window !== "undefined" ? window.location.href : "";
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <button
      onClick={copy}
      title={t("Copy link")}
      className="inline-flex items-center gap-1 rounded align-middle underline-offset-4 hover:text-muted"
    >
      {copied ? (
        <>
          <svg viewBox="0 0 16 16" className="h-3 w-3 text-gain" fill="none" aria-hidden="true">
            <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-gain">{t("Copied")}</span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
            <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M3 10.5V3.5A1.5 1.5 0 0 1 4.5 2h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          {t("Copy link")}
        </>
      )}
    </button>
  );
}
