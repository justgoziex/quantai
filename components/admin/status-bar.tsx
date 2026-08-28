"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

/*
  Operator status bar.

  Quiet when everything is healthy — a bar that is always green stops being
  read, and then it isn't a warning any more. So a healthy system gets one
  unobtrusive line, and anything broken opens the list of what and since when.
*/

type Service = { name: string; state: "operational" | "degraded" | "down"; detail: string };
type Health = { overall: Service["state"]; checkedAt: string; services: Service[] };

const TONE = {
  operational: { dot: "bg-gain", text: "text-muted", border: "border-line" },
  degraded: { dot: "bg-amber", text: "text-amber", border: "border-amber/40" },
  down: { dot: "bg-loss", text: "text-loss", border: "border-loss/50" },
} as const;

export function AdminStatusBar() {
  const { getToken } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const r = await fetch("/api/admin/health", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (r.ok) setHealth(await r.json());
    } catch {
      /* transient — the next tick retries */
    }
  }, [getToken]);

  useEffect(() => {
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [load]);

  // anything not operational opens the panel on its own, once
  useEffect(() => {
    if (health && health.overall !== "operational") setOpen(true);
  }, [health?.overall]);

  if (!health) {
    return <div className="h-9 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  const broken = health.services.filter((s) => s.state !== "operational");
  const tone = TONE[health.overall];

  return (
    <div className={cn("rounded-md border bg-panel", tone.border)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden="true" />
          <span className={cn("text-sm", tone.text)}>
            {health.overall === "operational"
              ? "All systems operational"
              : broken.length === 1
                ? `${broken[0].name} — ${broken[0].detail}`
                : `${broken.length} services need attention`}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-data-sm text-faint">
            {new Date(health.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <svg
            viewBox="0 0 12 12"
            className={cn("h-3 w-3 text-faint transition-transform duration-fast", open && "rotate-180")}
            aria-hidden="true"
            fill="none"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="border-t border-line">
          {health.services.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-4 border-b border-line px-4 py-2 last:border-b-0"
            >
              <span className="flex items-center gap-2.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", TONE[s.state].dot)} aria-hidden="true" />
                <span className="text-sm text-bone">{s.name}</span>
              </span>
              <span className="text-right font-mono text-data-sm text-faint">{s.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
