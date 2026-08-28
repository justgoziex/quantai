"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { EmptyState } from "@/components/product/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { priceFmt } from "@/lib/mock-series";

/*
  Alerts desk: link Telegram (signals + price alerts delivered to chat),
  manage price alerts, and read the in-app notification feed.
*/
type TgStatus = { configured: boolean; linked: boolean; botUsername: string; code: string | null };
type PriceAlert = {
  id: string;
  direction: "ABOVE" | "BELOW";
  priceUsd: number;
  active: boolean;
  triggeredAt: string | null;
  token: { symbol: string; chain: string; address: string; priceUsd: number | null };
};
type Note = { id: string; title: string; body: string; readAt: string | null; createdAt: string };

export function AlertsClient() {
  const { ready, authenticated, getToken } = useAuth();
  const { t } = useI18n();
  const [tg, setTg] = useState<TgStatus | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const tok = await getToken();
      if (!tok) return;
      const h = { authorization: `Bearer ${tok}` };
      const [tgR, alR, ntR] = await Promise.all([
        fetch("/api/telegram/link", { headers: h }),
        fetch("/api/alerts/price", { headers: h }),
        fetch("/api/notifications", { headers: h }),
      ]);
      if (tgR.ok) setTg(await tgR.json());
      if (alR.ok) setAlerts((await alR.json()).alerts ?? []);
      if (ntR.ok) setNotes((await ntR.json()).notifications ?? []);
    } catch {
      /* retry next visit */
    }
  }, [getToken]);

  useEffect(() => {
    if (ready && authenticated) load();
  }, [ready, authenticated, load]);

  const connectTelegram = async () => {
    setBusy(true);
    try {
      const tok = await getToken();
      const r = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { authorization: `Bearer ${tok}` },
      });
      const d = (await r.json()) as { code?: string; botUsername?: string };
      if (d.code && d.botUsername) {
        window.open(`https://t.me/${d.botUsername}?start=${d.code}`, "_blank", "noopener");
      }
      // poll for the link landing
      const poll = setInterval(async () => {
        const tok2 = await getToken();
        const s = await fetch("/api/telegram/link", { headers: { authorization: `Bearer ${tok2}` } });
        if (s.ok) {
          const st = (await s.json()) as TgStatus;
          setTg(st);
          if (st.linked) clearInterval(poll);
        }
      }, 4000);
      setTimeout(() => clearInterval(poll), 90_000);
    } finally {
      setBusy(false);
    }
  };

  const unlinkTelegram = async () => {
    const tok = await getToken();
    await fetch("/api/telegram/link", { method: "DELETE", headers: { authorization: `Bearer ${tok}` } });
    load();
  };

  const removeAlert = async (id: string) => {
    const tok = await getToken();
    await fetch("/api/alerts/price", {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
      body: JSON.stringify({ id }),
    });
    load();
  };

  if (!ready) {
    return <div className="h-48 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  if (!authenticated) {
    return (
      <EmptyState
        label="Alerts"
        title="Sign in to set up alerts"
        description="Signals and price alerts, in-app or Telegram."
        action={
          <Button asChild>
            <Link href="/signin">{t("Sign in")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Telegram */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-2.5">
            <TelegramGlyph />
            <span className="text-label">Telegram</span>
            {tg?.linked ? <Badge variant="gain">{t("Connected")}</Badge> : null}
          </div>
          {tg === null ? (
            <Skeleton className="h-8 w-36" />
          ) : !tg.configured ? (
            <span className="font-mono text-data-sm text-faint">{t("Coming soon")}</span>
          ) : tg.linked ? (
            <Button size="sm" variant="ghost" onClick={unlinkTelegram}>
              {t("Disconnect")}
            </Button>
          ) : (
            <Button size="sm" onClick={connectTelegram} disabled={busy}>
              {t("Connect Telegram")}
            </Button>
          )}
        </div>
        <p className="px-5 py-3 text-sm text-muted">
          {tg?.linked
            ? t("Connected.")
            : t("Signals and alerts in your Telegram. Plus /price.")}
        </p>
      </section>

      {/* price alerts */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-5 py-3">
          <span className="text-label">{t("Price alerts")}</span>
        </div>
        {alerts === null ? (
          <Skeleton className="m-4 h-16" />
        ) : alerts.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">
            {t("No alerts yet.")}
          </p>
        ) : (
          alerts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <Link
                href={`/token/${a.token.chain.toLowerCase()}/${a.token.address}`}
                className="text-sm font-medium text-bone hover:underline underline-offset-4"
              >
                {a.token.symbol}
              </Link>
              <span className={a.direction === "ABOVE" ? "font-mono text-data-sm text-gain" : "font-mono text-data-sm text-loss"}>
                {a.direction === "ABOVE" ? "↑" : "↓"} {priceFmt(a.priceUsd)}
              </span>
              <span className="font-mono text-data-sm text-faint">
                {t("now")} {a.token.priceUsd != null ? priceFmt(a.token.priceUsd) : "—"}
              </span>
              {!a.active ? <Badge variant="amber">{t("Triggered")}</Badge> : null}
              <button
                onClick={() => removeAlert(a.id)}
                aria-label="Delete alert"
                className="ml-auto rounded p-1 text-faint transition-colors duration-fast hover:text-loss"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
          ))
        )}
      </section>

      {/* feed */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-5 py-3">
          <span className="text-label">{t("Alert feed")}</span>
        </div>
        {notes === null ? (
          <Skeleton className="m-4 h-20" />
        ) : notes.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">
            {t("Nothing yet.")}
          </p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="border-b border-line px-5 py-3 last:border-0">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-bone">{n.title}</p>
                {!n.readAt ? <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" /> : null}
                <span className="ml-auto font-mono text-data-sm text-faint">
                  <LiveTimeAgo date={n.createdAt} />
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{n.body}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function TelegramGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" fill="currentColor" aria-hidden="true">
      <path d="M17.9 3.2 2.5 9.1c-.8.3-.8 1.4 0 1.7l3.8 1.3 1.5 4.6c.2.7 1.1.9 1.6.4l2.1-2 3.9 2.9c.5.4 1.3.1 1.4-.6l2-13c.1-.8-.6-1.4-1.3-1.2ZM7.3 11.6l7.6-4.9c.2-.1.4.1.2.3l-6.2 5.9-.3 2.7-1.3-4Z" />
    </svg>
  );
}
