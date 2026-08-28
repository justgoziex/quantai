import { prisma } from "@/lib/db";
import { getMonetization } from "@/lib/config";
import type { ChainId, EvmChainId } from "@/lib/chains";
import { getAccount } from "./wallet";
import { resolveToken } from "./token";
import { executeBuy, executeSell, heldBalance, toWei } from "./swap";
import { buyFor, sellFor } from "./trade";
import { sendMessage } from "./telegram";
import { pick, price as fmtPrice, nativeSym, type Lang } from "./menu";

/*
  Standing orders — limit buys/sells and take-profit / stop-loss. Because the
  bot is custodial it can execute these autonomously: the checker runs every
  ingest tick, and any order whose live price crossed its trigger is filled by
  signing on the user's behalf. Orders are claimed atomically (ACTIVE→FILLING)
  so a fill can never happen twice across concurrent ticks.
*/
export type OrderKind = "LIMIT_BUY" | "LIMIT_SELL" | "TP" | "SL";

export async function placeOrder(opts: {
  botUserId: string;
  chain: ChainId;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  kind: OrderKind;
  triggerUsd: number;
  sizeNative?: number;
  pct?: number;
}) {
  return prisma.botOrder.create({ data: { status: "ACTIVE", ...opts } });
}

export async function listOrders(botUserId: string) {
  return prisma.botOrder.findMany({
    where: { botUserId, status: { in: ["ACTIVE", "FILLING"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function cancelOrder(botUserId: string, id: string) {
  await prisma.botOrder.updateMany({ where: { id, botUserId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
}

const triggered = (kind: string, priceUsd: number, trigger: number) =>
  kind === "LIMIT_BUY" || kind === "SL" ? priceUsd <= trigger : priceUsd >= trigger;

/*
  One checker pass — bounded. Called from the ingest loop. Fetches the current
  price per distinct token (DB-first via resolveToken), fills crossed orders.
*/
export async function checkBotOrders(max = 60): Promise<number> {
  const orders = await prisma.botOrder.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: max,
  });
  if (orders.length === 0) return 0;

  const priceCache = new Map<string, number>();
  let filled = 0;

  for (const o of orders) {
    const chain = o.chain as ChainId;
    const key = `${chain}:${o.tokenAddress}`;
    let priceUsd = priceCache.get(key);
    if (priceUsd === undefined) {
      const t = await resolveToken(chain as EvmChainId, o.tokenAddress).catch(() => null);
      priceUsd = t?.priceUsd ?? 0;
      priceCache.set(key, priceUsd);
    }
    if (!priceUsd || !triggered(o.kind, priceUsd, o.triggerUsd)) continue;

    // claim it — only one worker proceeds
    const claim = await prisma.botOrder.updateMany({
      where: { id: o.id, status: "ACTIVE" },
      data: { status: "FILLING" },
    });
    if (claim.count === 0) continue;

    try {
      const user = await prisma.botUser.findUnique({ where: { id: o.botUserId } });
      if (!user) throw new Error("wallet");
      const lang = user.lang as Lang;

      /*
        Routed through the chain-aware layer so a standing order works the same
        on Solana as on the EVM chains. Calling the EVM path directly would
        have made every limit order, take-profit and stop-loss on a Solana
        position fail the moment it triggered — and a stop-loss that doesn't
        fire is worse than one that was never set.
      */
      let res;
      if (o.kind === "LIMIT_BUY") {
        res = await buyFor(o.botUserId, chain as ChainId, o.tokenAddress, o.sizeNative ?? 0, user.slippageBps, o.decimals);
      } else {
        res = await sellFor(o.botUserId, chain as ChainId, o.tokenAddress, o.pct ?? 100, user.slippageBps);
      }

      if (!res.ok) throw new Error(res.error);

      await prisma.botOrder.update({ where: { id: o.id }, data: { status: "FILLED", txHash: res.txHash, filledAt: new Date() } });
      await prisma.botTrade.create({
        data: {
          botUserId: o.botUserId,
          chain,
          tokenAddress: o.tokenAddress,
          symbol: o.symbol,
          side: o.kind === "LIMIT_BUY" ? "BUY" : "SELL",
          amountToken: res.amountToken,
          amountNative: res.amountNative,
          priceUsd,
        },
      }).catch(() => {});
      await creditReferral(user.id, res.amountNative);
      filled++;

      const label = kindLabel(o.kind, lang);
      await sendMessage(
        o.botUserId,
        `✅ <b>${label} ${pick(lang, "filled", "已成交")}</b> · ${o.symbol}\n` +
          `${o.kind === "LIMIT_BUY" ? `${res.amountToken.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${o.symbol}` : `+${res.amountNative.toFixed(5)} ${nativeSym(chain as ChainId)}`} @ ${fmtPrice(priceUsd)}`,
      );
    } catch (e) {
      await prisma.botOrder.update({ where: { id: o.id }, data: { status: "FAILED", note: (e as Error).message?.slice(0, 120) } }).catch(() => {});
      await sendMessage(o.botUserId, `❌ ${o.symbol} ${o.kind} order failed: ${(e as Error).message?.slice(0, 100)}`).catch(() => {});
    }
  }
  return filled;
}

function kindLabel(kind: string, lang: Lang): string {
  switch (kind) {
    case "LIMIT_BUY": return pick(lang, "Limit buy", "限价买入");
    case "LIMIT_SELL": return pick(lang, "Limit sell", "限价卖出");
    case "TP": return pick(lang, "Take-profit", "止盈");
    case "SL": return pick(lang, "Stop-loss", "止损");
    default: return kind;
  }
}

/*
  Referral fee share — credit the referrer a cut of the platform fee this trade
  generated (bookkeeping; the desk pays out referralEarned manually, like
  wallet cashback). Silent no-op when there's no referrer.
*/
export async function creditReferral(botUserId: string, tradeNative: number): Promise<void> {
  try {
    const user = await prisma.botUser.findUnique({ where: { id: botUserId }, select: { referredBy: true } });
    if (!user?.referredBy) return;
    const mon = await getMonetization();
    const feeNative = tradeNative * (mon.swapFeeBps / 10_000);
    const cut = feeNative * 0.3; // 30% of the fee to the referrer
    if (cut <= 0) return;
    await prisma.botUser.updateMany({ where: { chatId: user.referredBy }, data: { referralEarned: { increment: cut } } });
  } catch {
    /* non-blocking */
  }
}
