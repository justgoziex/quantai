import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSystemStatus, type ServiceStatus } from "@/lib/status";
import { getChannelConfig, getMonetization } from "@/lib/config";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
  GET /api/admin/health — operator view of what's broken.

  The public status page answers "is the site up". This answers the questions
  only whoever runs it can act on: is the bot reachable, is the channel still
  posting, are the upstreams the scoring depends on configured, can fees
  actually be collected.

  Configuration is reported as booleans. A health endpoint that echoed back
  key values would turn a diagnostic into a way to read secrets.
*/
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const services: ServiceStatus[] = [];

  // ── telegram bot ──
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) {
    services.push({ name: "Telegram bot", state: "down", detail: "No bot token set" });
  } else {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(6_000),
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null;
      services.push({
        name: "Telegram bot",
        state: j?.ok ? "operational" : "down",
        detail: j?.ok ? `Connected as @${j.result?.username ?? "bot"}` : "Telegram rejected the token",
      });
    } catch {
      services.push({ name: "Telegram bot", state: "down", detail: "Telegram unreachable" });
    }
  }

  // ── channel calls ──
  try {
    const cfg = await getChannelConfig();
    const last = await prisma.channelCall.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, symbol: true },
    });
    const hrs = last ? (Date.now() - last.createdAt.getTime()) / 3_600_000 : Infinity;

    /*
      Count what clears the filters, so a silent channel can be told apart from
      an empty one. "No calls for six hours" is the same message whether there
      is nothing worth calling or something downstream is rejecting everything
      — and those need opposite responses.
    */
    const now = Date.now();
    const candidates = await prisma.token.count({
      where: {
        blacklisted: false,
        marketCapUsd: { gte: cfg.minMcapUsd, lte: cfg.maxMcapUsd },
        liquidityUsd: { gte: cfg.minLiquidityUsd },
        ...(cfg.minScore > 0 ? { currentScore: { gte: cfg.minScore } } : {}),
        pairCreatedAt: {
          gte: new Date(now - cfg.maxPairAgeDays * 86_400_000),
          lte: new Date(now - cfg.minPairAgeMins * 60_000),
        },
        NOT: { flags: { hasSome: ["HONEYPOT_RISK", "RUG_RISK", "HIGH_TAX"] } },
      },
    });

    const stalled = candidates > 20 && hrs > 3;
    services.push({
      name: "Channel calls",
      state: !cfg.enabled || !cfg.chatId ? "down" : stalled ? "degraded" : hrs <= 6 ? "operational" : "degraded",
      detail: !cfg.enabled
        ? "Turned off in config"
        : !cfg.chatId
          ? "No channel set"
          : stalled && cfg.requireTelegram
            ? `${candidates} tokens qualify but nothing posted in ${Math.round(hrs)}h — "require Telegram" is likely rejecting them`
            : last
              ? `Last call ${hrs < 1 ? `${Math.round(hrs * 60)} min` : `${Math.round(hrs)}h`} ago · ${candidates} qualify now`
              : `No calls yet · ${candidates} qualify now`,
    });
  } catch {
    services.push({ name: "Channel calls", state: "degraded", detail: "Channel query failed" });
  }

  /*
    Solana scoring upstreams. Without at least one indexed RPC the fast
    security read returns nothing and every Solana token silently sits at its
    provisional score — a failure that shows up as bad data, not an error.
  */
  const helius = Boolean(process.env.HELIUS_API_KEY);
  const quicknode = Boolean(process.env.QUICKNODE_SOLANA_RPC);
  services.push({
    name: "Solana scoring",
    state: helius || quicknode ? "operational" : "down",
    detail:
      helius || quicknode
        ? `Indexed RPC ready${process.env.BIRDEYE_API_KEY ? " · holder counts on" : " · no holder counts"}`
        : "No indexed RPC — Solana tokens can't be fully scored",
  });

  // ── trade routing ──
  try {
    const r = await fetch(
      "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263&amount=100000000&slippageBps=500",
      { signal: AbortSignal.timeout(8_000), cache: "no-store" },
    );
    services.push({
      name: "Solana trade routing",
      state: r.ok ? "operational" : "degraded",
      detail: r.ok ? "Routing quotes returning" : `Router responded ${r.status}`,
    });
  } catch {
    services.push({ name: "Solana trade routing", state: "degraded", detail: "Router unreachable" });
  }

  // ── fee collection ──
  try {
    const mon = await getMonetization();
    const evmReady = /^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet);
    const solReady = mon.feeWalletSol.length > 30 && mon.devListingFeeSol > 0;
    services.push({
      name: "Fee collection",
      state: evmReady && solReady ? "operational" : evmReady || solReady ? "degraded" : "down",
      detail:
        evmReady && solReady
          ? "EVM and Solana wallets set"
          : evmReady
            ? "Solana fee wallet or SOL listing fee missing"
            : solReady
              ? "EVM fee wallet missing"
              : "No fee wallets set — payments will be refused",
    });
  } catch {
    services.push({ name: "Fee collection", state: "degraded", detail: "Config unreadable" });
  }

  // public checks (database, indexers, feeds) sit alongside these
  const base = await getSystemStatus();
  const all = [...base.services, ...services];
  const overall = all.some((s) => s.state === "down")
    ? "down"
    : all.some((s) => s.state === "degraded")
      ? "degraded"
      : "operational";

  return NextResponse.json({ overall, checkedAt: new Date().toISOString(), services: all });
}
