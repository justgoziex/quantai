import type { Metadata } from "next";
import { Nav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/status/auto-refresh";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { getSystemStatus, type ServiceState } from "@/lib/status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/status" },
  title: "Status",
};

const STATE_META: Record<ServiceState, { label: string; badge: "gain" | "warn" | "loss"; dot: string }> = {
  operational: { label: "Operational", badge: "gain", dot: "bg-gain" },
  degraded: { label: "Degraded", badge: "warn", dot: "bg-warn" },
  down: { label: "Down", badge: "loss", dot: "bg-loss" },
};

const OVERALL_COPY: Record<ServiceState, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  down: "Service disruption",
};

export default async function StatusPage() {
  const status = await getSystemStatus();
  const overall = STATE_META[status.overall];

  return (
    <>
      <Nav />
      <AutoRefresh seconds={30} />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line py-12">
          <div>
            <p className="text-label mb-4">System status</p>
            <h1 className="text-display-lg text-bone">{OVERALL_COPY[status.overall]}</h1>
          </div>
          <span
            className={cn(
              "flex items-center gap-2 font-mono text-data",
              status.overall === "operational"
                ? "text-gain"
                : status.overall === "degraded"
                  ? "text-warn"
                  : "text-loss",
            )}
          >
            <span
              className={cn("h-2 w-2 rounded-full motion-safe:animate-live-pulse", overall.dot)}
              aria-hidden="true"
            />
            {overall.label.toUpperCase()}
          </span>
        </header>

        <div className="mt-10 overflow-hidden rounded-md border border-line">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-2.5 font-mono text-data-sm uppercase tracking-[0.1em] text-muted sm:grid-cols-[1fr_1.2fr_auto_auto]">
            <span>Service</span>
            <span className="hidden sm:block">Detail</span>
            <span className="text-right">Latency</span>
            <span className="text-right">State</span>
          </div>
          {status.services.map((s) => {
            const meta = STATE_META[s.state];
            return (
              <div
                key={s.name}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-line bg-panel px-5 py-3.5 last:border-0 sm:grid-cols-[1fr_1.2fr_auto_auto]"
              >
                <span className="text-sm text-bone">{s.name}</span>
                <span className="hidden text-xs text-muted sm:block">{s.detail}</span>
                <span className="text-right font-mono text-data text-muted">
                  {s.latencyMs != null ? `${s.latencyMs}ms` : "—"}
                </span>
                <span className="text-right">
                  <Badge variant={meta.badge}>{meta.label}</Badge>
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-6 font-mono text-data-sm text-faint">
          Live checks against the database, chain indexers, and data upstreams · measured{" "}
          <LiveTimeAgo date={status.checkedAt} /> · refreshes every 30s
        </p>
      </main>
      <Footer />
    </>
  );
}
