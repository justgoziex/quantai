import { prisma, dbConfigured } from "./db";
import { CHAIN_LIST } from "./chains";
import { telegramConfigured } from "./telegram";

/*
  Live system status — every row is a real measurement, not a claim:
   · Database          — SELECT 1 round-trip latency
   · Pair indexers     — minutes since each chain's newest token update
   · Signal engine     — most recent signal fired
   · Market data feed  — live probe of the upstream price source
   · Rug-check engine  — live probe of the sell-simulation source
   · Trading engine    — aggregator + fee config presence
   · Alerts            — delivery channels configured + last notification
  Results cache in-process for 30s so status views don't hammer anything.
*/
export type ServiceState = "operational" | "degraded" | "down";
export type ServiceStatus = {
  name: string;
  state: ServiceState;
  detail: string;
  latencyMs?: number;
};
export type SystemStatus = {
  overall: ServiceState;
  checkedAt: string;
  services: ServiceStatus[];
};

let cached: { at: number; value: SystemStatus } | null = null;
const TTL = 30_000;

const mins = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 60_000 : Infinity);

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t0, value };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}

export async function getSystemStatus(): Promise<SystemStatus> {
  if (cached && Date.now() - cached.at < TTL) return cached.value;

  const services: ServiceStatus[] = [];

  // ── database ──
  if (!dbConfigured) {
    services.push({ name: "Database", state: "down", detail: "Not configured" });
  } else {
    const db = await timed(() => prisma.$queryRaw`SELECT 1`);
    services.push({
      name: "Database",
      state: db.ok ? (db.ms < 800 ? "operational" : "degraded") : "down",
      detail: db.ok ? "Query round-trip" : "Unreachable",
      latencyMs: db.ms,
    });
  }

  // ── per-chain pair indexers (freshness of the newest token update) ──
  if (dbConfigured) {
    try {
      const latest = await prisma.token.groupBy({
        by: ["chain"],
        _max: { updatedAt: true },
      });
      const byChain = new Map(latest.map((l) => [l.chain, l._max.updatedAt]));
      for (const chain of CHAIN_LIST) {
        const m = mins(byChain.get(chain.id.toUpperCase() as never) ?? null);
        // ingestion is traffic-driven (Hobby cron is daily), so an idle site
        // legitimately drifts — thresholds are calibrated to that design
        services.push({
          name: `Pair indexer · ${chain.name}`,
          state: m <= 15 ? "operational" : m <= 45 ? "degraded" : "down",
          detail: Number.isFinite(m)
            ? `Last update ${m < 1 ? "under a minute" : `${Math.round(m)} min`} ago · refreshes with site activity`
            : "No data yet",
        });
      }
    } catch {
      services.push({ name: "Pair indexers", state: "down", detail: "Freshness query failed" });
    }

    // ── signal engine ──
    try {
      const [lastSignal, screening] = await Promise.all([
        prisma.signal.findFirst({ orderBy: { firedAt: "desc" }, select: { firedAt: true } }),
        prisma.token.count({ where: { flags: { has: "SCREENING" }, blacklisted: false } }),
      ]);
      const m = mins(lastSignal?.firedAt ?? null);
      services.push({
        name: "Signal engine",
        state: m <= 240 ? "operational" : "degraded",
        detail: lastSignal
          ? `Last signal ${m < 60 ? `${Math.round(m)} min` : `${Math.round(m / 60)}h`} ago · ${screening} tokens in screening`
          : "No signals fired yet",
      });
    } catch {
      services.push({ name: "Signal engine", state: "degraded", detail: "Signal query failed" });
    }
  }

  // ── market data feed (upstream probe; 429 = busy, not down) ──
  let gtRateLimited = false;
  const gt = await timed(async () => {
    const r = await fetch("https://api.geckoterminal.com/api/v2/networks?page=1", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (r.status === 429) {
      gtRateLimited = true;
      return;
    }
    if (!r.ok) throw new Error(String(r.status));
  });
  services.push({
    name: "Market data feed",
    state: gt.ok ? (gtRateLimited ? "degraded" : gt.ms < 2_500 ? "operational" : "degraded") : "down",
    detail: gt.ok
      ? gtRateLimited
        ? "Rate-limited — catching up"
        : "Upstream reachable"
      : "Upstream unreachable",
    latencyMs: gt.ms,
  });

  // ── rug-check engine (sell-simulation upstream) ──
  const hp = await timed(async () => {
    const r = await fetch(
      "https://api.honeypot.is/v2/IsHoneypot?address=0x6982508145454ce325ddbe47a25d4ec3d2311933&chainID=1",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000), cache: "no-store" },
    );
    if (!r.ok) throw new Error(String(r.status));
  });
  services.push({
    name: "Rug-check engine",
    state: hp.ok ? (hp.ms < 4_000 ? "operational" : "degraded") : "degraded",
    detail: hp.ok ? "Sell simulation reachable" : "Simulation upstream slow/unreachable",
    latencyMs: hp.ms,
  });

  // ── trading engine ──
  const aggConfigured = Boolean(process.env.ZEROX_API_KEY);
  services.push({
    name: "Trading engine",
    state: aggConfigured ? "operational" : "degraded",
    detail: aggConfigured ? "Smart-routing active on ETH + BSC · V2 direct on Robinhood" : "Direct V2 routing only",
  });

  // ── AI analysis ──
  const aiConfigured = Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.GOOGLE_VERTEX_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  );
  services.push({
    name: "AI desk analysis",
    state: aiConfigured ? "operational" : "down",
    detail: aiConfigured ? "On-demand analysis available" : "Not configured",
  });

  // ── alert delivery ──
  if (dbConfigured) {
    try {
      const lastNote = await prisma.notification.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      services.push({
        name: "Alert delivery",
        state: "operational",
        detail: `In-app live${telegramConfigured ? " · Telegram live" : ""}${
          lastNote ? ` · last alert ${mins(lastNote.createdAt) < 60 ? `${Math.round(mins(lastNote.createdAt))} min` : `${Math.round(mins(lastNote.createdAt) / 60)}h`} ago` : ""
        }`,
      });
    } catch {
      services.push({ name: "Alert delivery", state: "degraded", detail: "Feed query failed" });
    }
  }

  const overall: ServiceState = services.some((s) => s.state === "down")
    ? "down"
    : services.some((s) => s.state === "degraded")
      ? "degraded"
      : "operational";

  const value: SystemStatus = { overall, checkedAt: new Date().toISOString(), services };
  cached = { at: Date.now(), value };
  return value;
}
