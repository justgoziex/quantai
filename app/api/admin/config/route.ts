import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, auditLog } from "@/lib/admin";
import { badRequest } from "@/lib/api";
import {
  getKillSwitches,
  getRewardConfig,
  getRewardSwitches,
  getAnnouncement,
  getMonetization,
  getChannelConfig,
  getLaunchBanner,
  setConfig,
  getLiquidityPartner,
  DEFAULT_KILLS,
  DEFAULT_REWARDS,
  DEFAULT_REWARD_SWITCHES,
  DEFAULT_MONETIZATION,
  DEFAULT_CHANNEL,
  getCreatorCashback,
  DEFAULT_CREATOR_CASHBACK,
} from "@/lib/config";

export const dynamic = "force-dynamic";

/* GET /api/admin/config — kill switches + rewards + announcement + fees. */
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;
  const [killSwitches, rewards, rewardSwitches, announcement, monetization, channelCalls, launchBanner, creatorCashback, liquidityPartner, detected] =
    await Promise.all([
      getKillSwitches(),
      getRewardConfig(),
      getRewardSwitches(),
      getAnnouncement(),
      getMonetization(),
      getChannelConfig(),
      getLaunchBanner(),
      getCreatorCashback(),
      getLiquidityPartner(),
      prisma.platformConfig.findUnique({ where: { key: "channelDetected" } }).catch(() => null),
    ]);
  return NextResponse.json({
    killSwitches,
    rewards,
    rewardSwitches,
    announcement,
    monetization,
    channelCalls,
    launchBanner,
    liquidityPartner,
    creatorCashback,
    // last chat the bot was added to — the trustworthy source for a channel id
    channelDetected: detected?.value ?? null,
  });
}

/* POST /api/admin/config — update any block. */
export async function POST(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    killSwitches?: Record<string, boolean>;
    rewards?: Record<string, number>;
    rewardSwitches?: Record<string, boolean>;
    announcement?: { enabled?: boolean; text?: string };
    launchBanner?: { enabled?: boolean };
    liquidityPartner?: { enabled?: boolean };
    creatorCashback?: Record<string, unknown>;
  monetization?: {
      swapFeeBps?: number;
      feeWallet?: string;
      feeWalletSol?: string;
      launchFeeEth?: number;
      launchFeeBnb?: number;
      redemptionFeeEth?: number;
      devListingFeeEth?: number;
    devListingFeeSol?: number;
      adFeePerDayEth?: number;
      adSlots?: number;
      feeTolerancePct?: number;
    };
    channelCalls?: {
      enabled?: boolean;
      chatId?: string;
      minMcapUsd?: number;
      maxMcapUsd?: number;
      minVolume24hUsd?: number;
      minLiquidityUsd?: number;
      minPriceChangePct?: number;
      maxMcapLiqRatio?: number;
      minPairAgeMins?: number;
      maxPairAgeDays?: number;
      maxSellBuyRatio5m?: number;
      maxVolLiqRatio24h?: number;
      minTxns5mTotal?: number;
      requireTelegram?: boolean;
      minScore?: number;
      postIntervalMinMins?: number;
      postIntervalMaxMins?: number;
      milestones?: unknown;
      retireDropPct?: number;
      retireLiqPct?: number;
      adText?: string;
      adUrl?: string;
    };
  } | null;
  if (!body) return badRequest("Missing config payload.");

  if (body.killSwitches) {
    const clean = Object.fromEntries(
      Object.keys(DEFAULT_KILLS).map((k) => [k, body.killSwitches![k] === true]),
    );
    await setConfig("killSwitches", clean);
    await auditLog(res.user.id, "config.killSwitches", "PlatformConfig", "killSwitches", clean);
  }
  if (body.rewards) {
    const clean = Object.fromEntries(
      Object.keys(DEFAULT_REWARDS).map((k) => {
        const v = Number(body.rewards![k]);
        return [k, Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_REWARDS[k as keyof typeof DEFAULT_REWARDS]];
      }),
    );
    await setConfig("rewards", clean);
    await auditLog(res.user.id, "config.rewards", "PlatformConfig", "rewards", clean);
  }

  if (body.rewardSwitches) {
    const clean = Object.fromEntries(
      Object.keys(DEFAULT_REWARD_SWITCHES).map((k) => [k, body.rewardSwitches![k] !== false]),
    );
    await setConfig("rewardSwitches", clean);
    await auditLog(res.user.id, "config.rewardSwitches", "PlatformConfig", "rewardSwitches", clean);
  }

  if (body.liquidityPartner) {
    await setConfig("liquidityPartner", { enabled: body.liquidityPartner.enabled === true });
  }

  if (body.announcement) {
    const clean = {
      enabled: body.announcement.enabled === true,
      text: String(body.announcement.text ?? "").slice(0, 200),
    };
    await setConfig("announcement", clean);
    await auditLog(res.user.id, "config.announcement", "PlatformConfig", "announcement", clean);
  }

  if (body.launchBanner) {
    const clean = { enabled: body.launchBanner.enabled === true };
    await setConfig("launchBanner", clean);
    await auditLog(res.user.id, "config.launchBanner", "PlatformConfig", "launchBanner", clean);
  }

  if (body.creatorCashback) {
    /*
      Pricing, so every number is the desk's — but bounded, because a stray
      keystroke here is a payout. Weights can't exceed one and the multiple
      can't exceed ten, which caps the worst a typo can cost.
    */
    const c = body.creatorCashback as Record<string, unknown>;
    const num = (v: unknown, fallback: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
    };
    const clean = {
      enabled: Boolean(c.enabled),
      minSol: num(c.minSol, DEFAULT_CREATOR_CASHBACK.minSol, 500),
      maxSol: num(c.maxSol, DEFAULT_CREATOR_CASHBACK.maxSol, 500),
      minEth: num(c.minEth, DEFAULT_CREATOR_CASHBACK.minEth, 20),
      maxEth: num(c.maxEth, DEFAULT_CREATOR_CASHBACK.maxEth, 20),
      minBnb: num(c.minBnb, DEFAULT_CREATOR_CASHBACK.minBnb, 100),
      maxBnb: num(c.maxBnb, DEFAULT_CREATOR_CASHBACK.maxBnb, 100),
      peakFloorUsd: num(c.peakFloorUsd, DEFAULT_CREATOR_CASHBACK.peakFloorUsd, 1e9),
      peakCeilingUsd: num(c.peakCeilingUsd, DEFAULT_CREATOR_CASHBACK.peakCeilingUsd, 1e10),
      minLiquidityUsd: num(c.minLiquidityUsd, DEFAULT_CREATOR_CASHBACK.minLiquidityUsd, 1e9),
    };
    await setConfig("creatorCashback", clean);
    await auditLog(res.user.id, "config.creatorCashback", "PlatformConfig", "creatorCashback", clean);
  }

  if (body.monetization) {
    const m = body.monetization;
    const wallet = String(m.feeWallet ?? "").trim();
    const num = (v: unknown, fallback: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
    };
    const clean = {
      swapFeeBps: Math.round(num(m.swapFeeBps, DEFAULT_MONETIZATION.swapFeeBps, 500)), // cap 5%
      feeWallet: /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet : "",
      // base58, kept verbatim — Solana addresses are case-sensitive
      feeWalletSol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(m.feeWalletSol ?? "").trim())
        ? String(m.feeWalletSol).trim()
        : "",
      launchFeeEth: num(m.launchFeeEth, DEFAULT_MONETIZATION.launchFeeEth, 100),
      launchFeeBnb: num(m.launchFeeBnb, DEFAULT_MONETIZATION.launchFeeBnb, 1000),
      redemptionFeeEth: num(m.redemptionFeeEth, DEFAULT_MONETIZATION.redemptionFeeEth, 10),
      devListingFeeEth: num(m.devListingFeeEth, DEFAULT_MONETIZATION.devListingFeeEth, 100),
      /*
        The Solana listing fee was missing from this list, so every save
        dropped it and the stored value never changed — the desk set 0.001 and
        the site kept charging 0.1, with nothing reporting a problem. Any field
        absent here is silently discarded, which is why this must match the
        config type exactly.
      */
      devListingFeeSol: num(m.devListingFeeSol, DEFAULT_MONETIZATION.devListingFeeSol, 1000),
      adFeePerDayEth: num(m.adFeePerDayEth, DEFAULT_MONETIZATION.adFeePerDayEth, 100),
      adSlots: Math.round(num(m.adSlots, DEFAULT_MONETIZATION.adSlots, 10)),
      feeTolerancePct: num(m.feeTolerancePct, DEFAULT_MONETIZATION.feeTolerancePct, 50),
    };
    await setConfig("monetization", clean);
    await auditLog(res.user.id, "config.monetization", "PlatformConfig", "monetization", clean);
  }

  if (body.channelCalls) {
    const c = body.channelCalls;
    const num = (v: unknown, fallback: number, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
    };
    /*
      A channel id is either an @handle or the numeric -100… form. Anything
      else is rejected to "" so a typo silently disables posting instead of
      firing calls at the wrong chat.
    */
    const chatId = String(c.chatId ?? "").trim();
    const validChat = /^@[A-Za-z0-9_]{4,}$/.test(chatId) || /^-?\d{6,}$/.test(chatId) ? chatId : "";
    const ms = Array.isArray(c.milestones)
      ? [...new Set((c.milestones as unknown[]).map((x) => Math.round(Number(x))).filter((x) => x >= 2 && x <= 1000))].sort(
          (a, b) => a - b,
        )
      : DEFAULT_CHANNEL.milestones;
    const D = DEFAULT_CHANNEL;
    // the gap floor is 1 minute, so a mistyped 0 can't machine-gun the channel
    const lo = Math.round(num(c.postIntervalMinMins, D.postIntervalMinMins, 1, 1440));
    const hi = Math.round(num(c.postIntervalMaxMins, D.postIntervalMaxMins, 1, 1440));
    const clean = {
      enabled: c.enabled === true,
      chatId: validChat,
      minMcapUsd: Math.round(num(c.minMcapUsd, D.minMcapUsd, 0, 1e12)),
      maxMcapUsd: Math.round(num(c.maxMcapUsd, D.maxMcapUsd, 1, 1e12)),
      minVolume24hUsd: Math.round(num(c.minVolume24hUsd, D.minVolume24hUsd, 0, 1e12)),
      minLiquidityUsd: Math.round(num(c.minLiquidityUsd, D.minLiquidityUsd, 0, 1e12)),
      minPriceChangePct: num(c.minPriceChangePct, D.minPriceChangePct, -100, 1000),
      maxMcapLiqRatio: num(c.maxMcapLiqRatio, D.maxMcapLiqRatio, 0.1, 10000),
      minPairAgeMins: Math.round(num(c.minPairAgeMins, D.minPairAgeMins, 0, 100000)),
      maxPairAgeDays: Math.round(num(c.maxPairAgeDays, D.maxPairAgeDays, 1, 3650)),
      maxSellBuyRatio5m: num(c.maxSellBuyRatio5m, D.maxSellBuyRatio5m, 0.1, 100),
      maxVolLiqRatio24h: num(c.maxVolLiqRatio24h, D.maxVolLiqRatio24h, 0.1, 10000),
      minTxns5mTotal: Math.round(num(c.minTxns5mTotal, D.minTxns5mTotal, 0, 100000)),
      requireTelegram: c.requireTelegram !== false,
      minScore: Math.round(num(c.minScore, D.minScore, 0, 100)),
      postIntervalMinMins: Math.min(lo, hi),
      postIntervalMaxMins: Math.max(lo, hi),
      milestones: ms.length > 0 ? ms : D.milestones,
      retireDropPct: num(c.retireDropPct, D.retireDropPct, 1, 99),
      retireLiqPct: num(c.retireLiqPct, D.retireLiqPct, 1, 99),
      adText: String(c.adText ?? "").slice(0, 60),
      adUrl: String(c.adUrl ?? "").trim().slice(0, 300),
    };
    await setConfig("channelCalls", clean);
    // audit meta is flat — milestones go in as a readable list
    await auditLog(res.user.id, "config.channelCalls", "PlatformConfig", "channelCalls", {
      ...clean,
      milestones: clean.milestones.join(","),
    });
  }

  const [killSwitches, rewards, rewardSwitches, announcement, monetization, channelCalls] = await Promise.all([
    getKillSwitches(),
    getRewardConfig(),
    getRewardSwitches(),
    getAnnouncement(),
    getMonetization(),
    getChannelConfig(),
  ]);
  return NextResponse.json({ ok: true, killSwitches, rewards, rewardSwitches, announcement, monetization, channelCalls });
}
