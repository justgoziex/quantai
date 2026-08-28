"use client";

import { useEffect, useState } from "react";

/*
  Site-wide operator announcement — polls the public config, dismissible per
  message (remembered in sessionStorage so it re-shows when the text changes).
*/
export function AnnouncementBanner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/announcement")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (d.enabled && d.text) {
            const dismissed = sessionStorage.getItem("quantai:annDismissed");
            setMsg(dismissed === d.text ? null : d.text);
          } else {
            setMsg(null);
          }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!msg) return null;

  return (
    <div className="border-b border-amber/30 bg-amber/10">
      <div className="mx-auto flex max-w-wrap items-center justify-between gap-4 px-6 py-2">
        <p className="text-sm text-bone">
          <span className="text-label mr-2 text-amber">NOTICE</span>
          {msg}
        </p>
        <button
          onClick={() => {
            sessionStorage.setItem("quantai:annDismissed", msg);
            setMsg(null);
          }}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-amber/70 transition-colors duration-fast hover:text-amber"
        >
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
