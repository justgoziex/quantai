import { prisma, dbConfigured } from "./db";

/*
  Platform configuration — kill switches and reward overrides, stored in
  PlatformConfig and cached in-process for 10s so hot paths stay fast.
*/
export type KillSwitches = {
  launcher: boolean;
  ai: boolean;
  ingest: boolean;
  rewards: boolean;
  trading: boolean;
  lookup: boolean;
};

/*
  Reward amounts are stored in POINTS where 1 point = 1 µETH (1e-6 ETH) —
  the integer ledger stays intact while everything user-facing reads in ETH.
*/
export type RewardConfig = {
  referralQualified: number;
  firstTrade: number;
  launch: number;
};

/* Per-reward kill switches — admin can turn each reward stream on/off. */
export type RewardSwitches = {
  referral: boolean;
  firstTrade: boolean;
  launch: boolean;
  tradeCashback: boolean;
  walletCashback: boolean;
};
export const DEFAULT_REWARD_SWITCHES: RewardSwitches = {
  referral: true,
  firstTrade: true,
  launch: true,
  tradeCashback: true,
  walletCashback: true,
};

export const DEFAULT_KILLS: KillSwitches = {
  launcher: false,
  ai: false,
  ingest: false,
  rewards: false,
  trading: false,
  lookup: false,
};

export const DEFAULT_REWARDS: RewardConfig = {
  referralQualified: 2_500, // 0.0025 ETH
  firstTrade: 250, // 0.00025 ETH
  launch: 500, // 0.0005 ETH
};

/*
  The one-time launch modal. Users dismiss it individually, but once a launch
  stops being news the desk turns it off for everyone here rather than waiting
  for each person to close it.
*/
export type LaunchBannerConfig = { enabled: boolean };
export const DEFAULT_LAUNCH_BANNER: LaunchBannerConfig = { enabled: true };

export function getLaunchBanner(): Promise<LaunchBannerConfig> {
  return getConfig("launchBanner", DEFAULT_LAUNCH_BANNER);
}

/*
  Liquidity partnership — off until the desk decides to offer it.

  Developers hand over a wallet key here, so this stays dark by default rather
  than shipping visible and being switched off after the fact. Admins see the
  section regardless of this flag, which is what makes it testable against real
  wallets before anyone else can reach it.
*/
export type LiquidityPartnerConfig = { enabled: boolean };
export const DEFAULT_LIQUIDITY_PARTNER: LiquidityPartnerConfig = { enabled: false };

export function getLiquidityPartner(): Promise<LiquidityPartnerConfig> {
  return getConfig("liquidityPartner", DEFAULT_LIQUIDITY_PARTNER);
}

export type Announcement = { enabled: boolean; text: string };
export const DEFAULT_ANNOUNCEMENT: Announcement = { enabled: false, text: "" };

export function getAnnouncement(): Promise<Announcement> {
  return getConfig("announcement", DEFAULT_ANNOUNCEMENT);
}

const cache = new Map<string, { value: unknown; at: number }>();
const TTL = 10_000;

async function getConfig<T>(key: string, fallback: T): Promise<T> {
  if (!dbConfigured) return fallback;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  try {
    const row = await prisma.platformConfig.findUnique({ where: { key } });
    const value = row ? { ...fallback, ...(row.value as object) } : fallback;
    cache.set(key, { value, at: Date.now() });
    return value as T;
  } catch {
    return fallback;
  }
}

export async function setConfig(key: string, value: object): Promise<void> {
  await prisma.platformConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.delete(key);
}

export function getKillSwitches(): Promise<KillSwitches> {
  return getConfig("killSwitches", DEFAULT_KILLS);
}

export async function isKilled(feature: keyof KillSwitches): Promise<boolean> {
  return (await getKillSwitches())[feature] === true;
}

export function getRewardConfig(): Promise<RewardConfig> {
  return getConfig("rewards", DEFAULT_REWARDS);
}

export function getRewardSwitches(): Promise<RewardSwitches> {
  return getConfig("rewardSwitches", DEFAULT_REWARD_SWITCHES);
}

/*
  Memecoin-trader cashback policy for connected external wallets. `text` is the
  public description shown on the rewards page; `defaultPoints` is a suggested
  award admins can apply per verified wallet. Admins decide the actual amount.
*/
export type WalletCashbackPolicy = {
  text: string;
  defaultPoints: number;
  /* cashback formula the desk applies: ETH per distinct token traded, capped */
  ethPerTradedToken: number;
  maxCashbackEth: number;
};
export const DEFAULT_WALLET_POLICY: WalletCashbackPolicy = {
  text: "Connect a wallet you've used to trade memecoins. Verified wallets are reviewed by the desk, and cashback is awarded in ETH based on your on-chain trading history — how many tokens you've traded and how active the wallet is.",
  defaultPoints: 250,
  ethPerTradedToken: 0.0002,
  maxCashbackEth: 0.05,
};

export function getWalletPolicy(): Promise<WalletCashbackPolicy> {
  return getConfig("externalWalletPolicy", DEFAULT_WALLET_POLICY);
}

/*
  Monetization — platform fees, admin-controlled. swapFeeBps is basis points
  (100 = 1%) taken on the native leg of every swap and routed to feeWallet;
  launch fees are flat native amounts charged at deploy. Fees only apply when
  feeWallet is a real address.
*/
export type MonetizationConfig = {
  swapFeeBps: number;
  feeWallet: string;
  /*
    Solana fees land in their own wallet — a base58 address, not hex, so it
    can't share the EVM one. Blank means Solana payments are off.
  */
  feeWalletSol: string;
  launchFeeEth: number;
  launchFeeBnb: number;
  redemptionFeeEth: number; // fee a user pays to redeem rewards to a wallet
  devListingFeeEth: number; // fee a developer pays to list their token
  devListingFeeSol: number; // the same fee on Solana, priced in SOL
  adFeePerDayEth: number; // fee per day for a promoted ad slot
  adSlots: number; // how many ads rotate at once
  /*
    How far under the quoted fee a payment may land and still be accepted.
    A fee paid by swapping a token arrives at whatever the pool gives, so
    demanding the exact figure would reject payments that are a fraction short
    after slippage — and the payer has already spent the token by then.
  */
  feeTolerancePct: number;
};
export const DEFAULT_MONETIZATION: MonetizationConfig = {
  swapFeeBps: 75, // 0.75%
  feeWallet: "",
  feeWalletSol: "",
  launchFeeEth: 0.02,
  launchFeeBnb: 0.1,
  redemptionFeeEth: 0.002,
  devListingFeeEth: 0.05,
  devListingFeeSol: 0.1,
  adFeePerDayEth: 0.03,
  adSlots: 3,
  feeTolerancePct: 5,
};

export function getMonetization(): Promise<MonetizationConfig> {
  return getConfig("monetization", DEFAULT_MONETIZATION);
}

/*
  Channel calls — the bot posts a call card to the Quant AI channel when the
  engine fires a high-conviction ENTRY, then threads a reply each time the call
  clears a gain multiple.

  `chatId` is the channel (@handle or the numeric -100… id); the bot must be an
  admin there to post. Nothing posts while it's blank, so the feature is off
  until the desk sets it.
*/
/*
  Selection rules, ported from the desk's own bullseye bot so the channel behaves
  the way its operator already knows. Small-cap bias, healthy liquidity relative
  to cap, recent real activity, not washed, and a Telegram community — then a
  random gap between posts rather than a fixed cadence.
*/
/*
  Creator cashback — what a developer earns back on a token they launched.

  The desk sets a range per chain, not a formula: "between 1 and 3 SOL a
  token". Where a token lands inside that range is decided by the highest
  market cap it ever reached, so a launch that genuinely worked pays more than
  one that didn't, and nothing pays outside the bounds the desk set.

  Pricing the peak rather than today's cap matters: a token that ran to ten
  million and settled back still earned its creator that run, and paying off
  the current number would give them nothing for it.
*/
export type CreatorCashbackConfig = {
  enabled: boolean;

  /* the payout band, per token, in each chain's own asset */
  minSol: number;
  maxSol: number;
  minEth: number;
  maxEth: number;
  minBnb: number;
  maxBnb: number;

  /*
    The two market caps that anchor the band. A token peaking at or below the
    floor earns the minimum; at or above the ceiling, the maximum. In between
    it scales — on a log curve, because the distance from $10k to $100k is a
    far bigger achievement than $900k to $1m.
  */
  peakFloorUsd: number;
  peakCeilingUsd: number;

  /* a token has to have been real before it earns anything */
  minLiquidityUsd: number;
};

export const DEFAULT_CREATOR_CASHBACK: CreatorCashbackConfig = {
  enabled: false, // off until the desk sets its numbers
  minSol: 1,
  maxSol: 3,
  minEth: 0.01,
  maxEth: 0.05,
  minBnb: 0.03,
  maxBnb: 0.15,
  peakFloorUsd: 25_000,
  peakCeilingUsd: 1_000_000,
  minLiquidityUsd: 5_000,
};

export function getCreatorCashback(): Promise<CreatorCashbackConfig> {
  return getConfig("creatorCashback", DEFAULT_CREATOR_CASHBACK);
}

export type ChannelConfig = {
  enabled: boolean;
  chatId: string;

  /* base metrics */
  minMcapUsd: number;
  maxMcapUsd: number;
  minVolume24hUsd: number;
  minLiquidityUsd: number;
  /* 6h and 24h change must both be above this */
  minPriceChangePct: number;
  /* market cap can't exceed liquidity by more than this multiple */
  maxMcapLiqRatio: number;

  /* rug / wash / sniper-bait gates */
  minPairAgeMins: number;
  maxPairAgeDays: number;
  /* sells can't exceed buys by more than this over 5m */
  maxSellBuyRatio5m: number;
  /* 24h volume above liquidity × this reads as wash trading */
  maxVolLiqRatio24h: number;
  minTxns5mTotal: number;
  /* a project with no Telegram has no community to call to */
  requireTelegram: boolean;

  /*
    Optional score floor. Bullseye has no equivalent, but the Quant card prints
    评分 on every call, so a floor keeps the channel from advertising a weak
    score. 0 disables it and matches bullseye exactly.
  */
  minScore: number;

  /* random gap between calls, in minutes — the pacing control */
  postIntervalMinMins: number;
  postIntervalMaxMins: number;

  /* gain multiples that earn a threaded update */
  milestones: number[];

  /*
    Retirement. A call that dumps this far below its call price, or whose pool
    shrinks to this fraction of its call liquidity, stops being tracked — no
    loss is ever posted, it just goes quiet.
  */
  retireDropPct: number;
  retireLiqPct: number;

  /* paid banner appended to each call (falls back to the ad rotation) */
  adText: string;
  adUrl: string;
};
export const DEFAULT_CHANNEL: ChannelConfig = {
  enabled: false,
  chatId: "",
  minMcapUsd: 8_000,
  maxMcapUsd: 1_000_000,
  minVolume24hUsd: 5_000,
  minLiquidityUsd: 4_000,
  // the 6h window must be genuinely rising — see the momentum gate in the sweep
  minPriceChangePct: 5,
  maxMcapLiqRatio: 5,
  minPairAgeMins: 30,
  maxPairAgeDays: 30,
  maxSellBuyRatio5m: 1.5,
  maxVolLiqRatio24h: 50,
  minTxns5mTotal: 5,
  requireTelegram: false,
  minScore: 50,
  postIntervalMinMins: 5,
  postIntervalMaxMins: 15,
  milestones: [2, 3, 5, 10, 25, 50, 100],
  retireDropPct: 50,
  retireLiqPct: 30,
  adText: "",
  adUrl: "",
};

export function getChannelConfig(): Promise<ChannelConfig> {
  return getConfig("channelCalls", DEFAULT_CHANNEL);
}
