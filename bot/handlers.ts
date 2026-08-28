import { prisma } from "@/lib/db";
import { getNativeUsd } from "@/lib/native-price";
import type { ChainId, EvmChainId } from "@/lib/chains";
import { botCryptoConfigured } from "./crypto";
import { sendMessage, editMessage, answerCallback, type Keyboard } from "./telegram";
import {
  getOrCreateUser,
  getWalletAddress,
  getAccount,
  nativeBalance,
  exportPrivateKey,
  importPrivateKey,
  type BotUserRow,
} from "./wallet";
import { resolveToken, type ResolvedToken } from "./token";
import { executeBuy, executeSell, heldBalance, toWei } from "./swap";
import { buyFor, sellFor, heldFor, walletAddressFor, nativeBalanceFor } from "./trade";
import { exportSolanaKey } from "./solana-wallet";
import { placeOrder, listOrders, cancelOrder, creditReferral, type OrderKind } from "./orders";
import {
  mainMenu,
  walletScreen,
  chainMenu,
  buyCard,
  settingsScreen,
  signalsScreen,
  pick,
  nativeSym,
  chainName,
  price,
  scoreEmoji,
  type Lang,
} from "./menu";

/*
  Update router for the Quant AI trading bot. Called by the webhook for every
  Telegram update. Custodial: buys/sells are signed server-side. Every screen
  is bilingual (EN / 中文).
*/
type TgMessage = {
  message_id?: number;
  chat?: { id?: number };
  text?: string;
  from?: { username?: string };
};
type TgUpdate = {
  message?: TgMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
    from?: { username?: string };
  };
};

const asChain = (c: string): ChainId => (c === "eth" || c === "bsc" || c === "rh" ? c : "bsc");
type Awaiting = "buyAmount" | "importKey" | "limitBuy" | "tpsl" | "limitSell";
type State = { mode?: "buy" | "sell"; token?: ResolvedToken; awaiting?: Awaiting } | null;
const nums = (s: string) => s.replace(/[^0-9.\s-]/g, "").trim().split(/\s+/).map(Number);

export async function handleBotUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) return await onCallback(update.callback_query);
    if (update.message) return await onMessage(update.message);
  } catch (e) {
    console.error("bot handler failed:", (e as Error).message);
  }
}

async function showMain(user: BotUserRow, chatId: string, editId?: number) {
  // the address shown must be the one for the chain in use — the two formats
  // are not interchangeable, and showing the wrong one invites a lost deposit
  const address = (await walletAddressFor(user.id, user.chain as ChainId)) ?? "";
  const bal = await nativeBalanceFor(user.id, user.chain as ChainId, address);
  const { text, keyboard } = mainMenu(user.lang as Lang, user.chain as ChainId, address, bal);
  if (editId) await editMessage(chatId, editId, text, keyboard);
  else await sendMessage(chatId, text, keyboard);
}

async function onMessage(msg: TgMessage) {
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  const text = (msg.text ?? "").trim();
  if (!chatId) return;

  if (!botCryptoConfigured()) {
    await sendMessage(chatId, "Bot wallet encryption isn't configured yet. Please try again shortly.");
    return;
  }

  const user = await getOrCreateUser(chatId, msg.from?.username);
  const lang = user.lang as Lang;
  const state = (user.state ?? null) as State;

  // awaiting a typed value (custom buy amount / imported key)
  if (state?.awaiting === "importKey") {
    const addr = await importPrivateKey(user.id, text);
    await setState(user.id, null);
    if (addr) await sendMessage(chatId, `✅ ${pick(lang, "Wallet imported", "钱包已导入")}: <code>${addr}</code>`);
    else await sendMessage(chatId, pick(lang, "That private key isn't valid.", "私钥无效。"));
    return await showMain({ ...user }, chatId);
  }
  if (state?.awaiting === "buyAmount" && state.token) {
    const amount = Number(text.replace(/[^0-9.]/g, ""));
    await setState(user.id, { mode: "buy", token: state.token });
    if (!Number.isFinite(amount) || amount <= 0) {
      await sendMessage(chatId, pick(lang, "Enter a number, e.g. 0.1", "请输入数字，例如 0.1"));
      return;
    }
    return await doBuy(user, chatId, state.token, amount);
  }
  if (state?.awaiting === "limitBuy" && state.token) {
    const [trigger, size] = nums(text);
    await setState(user.id, { mode: "buy", token: state.token });
    if (!trigger || !size || trigger <= 0 || size <= 0) {
      return void sendMessage(chatId, pick(lang, "Send: <price> <amount>  e.g.  0.0000012 0.1", "发送：<价格> <金额>  例如  0.0000012 0.1"));
    }
    await placeOrder({ botUserId: user.id, chain: user.chain as EvmChainId, tokenAddress: state.token.address, symbol: state.token.symbol, decimals: state.token.decimals, kind: "LIMIT_BUY", triggerUsd: trigger, sizeNative: size });
    return void sendMessage(chatId, `✅ ${pick(lang, "Limit buy set", "限价买入已设置")}: ${state.token.symbol} @ ${price(trigger)} · ${size} ${nativeSym(user.chain as ChainId)}`, [[{ text: pick(lang, "📋 Orders", "📋 订单"), data: "orders" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]]);
  }
  if (state?.awaiting === "limitSell" && state.token) {
    const [trigger, pct] = nums(text);
    await setState(user.id, { mode: "sell", token: state.token });
    if (!trigger || !pct || trigger <= 0 || pct <= 0 || pct > 100) {
      return void sendMessage(chatId, pick(lang, "Send: <price> <percent>  e.g.  0.00005 100", "发送：<价格> <百分比>  例如  0.00005 100"));
    }
    await placeOrder({ botUserId: user.id, chain: user.chain as EvmChainId, tokenAddress: state.token.address, symbol: state.token.symbol, decimals: state.token.decimals, kind: "LIMIT_SELL", triggerUsd: trigger, pct: Math.round(pct) });
    return void sendMessage(chatId, `✅ ${pick(lang, "Limit sell set", "限价卖出已设置")}: ${state.token.symbol} @ ${price(trigger)} · ${Math.round(pct)}%`, [[{ text: pick(lang, "📋 Orders", "📋 订单"), data: "orders" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]]);
  }
  if (state?.awaiting === "tpsl" && state.token) {
    const [tp, sl] = nums(text);
    await setState(user.id, { mode: "sell", token: state.token });
    const cur = state.token.priceUsd;
    if (!cur || (!tp && !sl)) {
      return void sendMessage(chatId, pick(lang, "Send: <take-profit%> <stop-loss%>  e.g.  50 30", "发送：<止盈%> <止损%>  例如  50 30"));
    }
    const made: string[] = [];
    if (tp && tp > 0) {
      await placeOrder({ botUserId: user.id, chain: user.chain as EvmChainId, tokenAddress: state.token.address, symbol: state.token.symbol, decimals: state.token.decimals, kind: "TP", triggerUsd: cur * (1 + tp / 100), pct: 100 });
      made.push(`TP +${tp}% @ ${price(cur * (1 + tp / 100))}`);
    }
    if (sl && sl > 0) {
      await placeOrder({ botUserId: user.id, chain: user.chain as EvmChainId, tokenAddress: state.token.address, symbol: state.token.symbol, decimals: state.token.decimals, kind: "SL", triggerUsd: cur * (1 - sl / 100), pct: 100 });
      made.push(`SL −${sl}% @ ${price(cur * (1 - sl / 100))}`);
    }
    return void sendMessage(chatId, `✅ ${state.token.symbol}: ${made.join(" · ")}`, [[{ text: pick(lang, "📋 Orders", "📋 订单"), data: "orders" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]]);
  }

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1]?.trim();
    if (code?.startsWith("ref_")) {
      const refChat = code.slice(4);
      if (refChat && refChat !== chatId) {
        await prisma.botUser.updateMany({ where: { chatId, referredBy: null }, data: { referredBy: refChat } }).catch(() => {});
      }
    }
    return await showMain(user, chatId);
  }
  if (text.startsWith("/menu")) return await showMain(user, chatId);
  if (text.startsWith("/help")) {
    await sendMessage(
      chatId,
      pick(
        lang,
        "Paste a token contract address to buy it. /menu for the dashboard.",
        "粘贴代币合约地址即可买入。/menu 打开面板。",
      ),
    );
    return;
  }

  /*
    A pasted contract address → buy card. Solana mints are base58, not hex, so
    matching only the EVM shape meant a pasted mint was treated as chat and
    silently ignored.
  */
  const pastedAddress =
    user.chain === "sol"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text.trim())
      : /^0x[0-9a-fA-F]{40}$/.test(text);
  if (pastedAddress) {
    await sendMessage(chatId, pick(lang, "Reading the token…", "正在读取代币…"));
    const token = await resolveToken(user.chain as ChainId, text);
    if (!token) {
      await sendMessage(chatId, pick(lang, "Couldn't find that token on this chain. Switch chains and retry.", "在该链上找不到此代币。切换链后重试。"));
      return;
    }
    await setState(user.id, { mode: "buy", token });
    const address = (await walletAddressFor(user.id, user.chain as ChainId)) ?? "";
    const bal = await nativeBalanceFor(user.id, user.chain as ChainId, address);
    const { text: t, keyboard } = buyCard(lang, user.chain as ChainId, token, bal);
    await sendMessage(chatId, t, keyboard);
    return;
  }

  await sendMessage(chatId, pick(lang, "Paste a token contract address (0x…) to buy, or /menu.", "粘贴代币合约地址（0x…）买入，或发送 /menu。"));
}

async function onCallback(cq: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cq.message?.chat?.id != null ? String(cq.message.chat.id) : "";
  const msgId = cq.message?.message_id;
  const data = cq.data ?? "";
  if (!chatId) return;
  const user = await getOrCreateUser(chatId, cq.from?.username);
  const lang = user.lang as Lang;
  const ack = (t?: string, alert = false) => answerCallback(cq.id, t, alert);

  // navigation
  if (data === "m") { await ack(); return await showMain(user, chatId, msgId); }
  if (data === "w") {
    await ack();
    const address = (await walletAddressFor(user.id, user.chain as ChainId)) ?? "";
    const bal = await nativeBalanceFor(user.id, user.chain as ChainId, address);
    const { text, keyboard } = walletScreen(lang, user.chain as ChainId, address, bal);
    return void (msgId ? editMessage(chatId, msgId, text, keyboard) : sendMessage(chatId, text, keyboard));
  }
  if (data === "chainmenu") { await ack(); const { text, keyboard } = chainMenu(lang, user.chain as ChainId); return void editMessage(chatId, msgId!, text, keyboard); }
  if (data.startsWith("chain:")) {
    const chain = asChain(data.slice(6));
    await prisma.botUser.update({ where: { id: user.id }, data: { chain } });
    await ack(pick(lang, `Switched to ${chainName(chain as ChainId)}`, `已切换到 ${chainName(chain as ChainId)}`));
    return await showMain({ ...user, chain: chain as EvmChainId }, chatId, msgId);
  }
  if (data === "s") { await ack(); const { text, keyboard } = settingsScreen(lang, user.slippageBps); return void editMessage(chatId, msgId!, text, keyboard); }
  if (data.startsWith("slip:")) {
    const bps = Number(data.slice(5));
    await prisma.botUser.update({ where: { id: user.id }, data: { slippageBps: bps } });
    await ack(pick(lang, "Slippage updated", "滑点已更新"));
    const { text, keyboard } = settingsScreen(lang, bps);
    return void editMessage(chatId, msgId!, text, keyboard);
  }
  if (data === "lang") {
    const next = lang === "zh" ? "en" : "zh";
    await prisma.botUser.update({ where: { id: user.id }, data: { lang: next } });
    await ack();
    return await showMain({ ...user, lang: next }, chatId, msgId);
  }
  if (data === "ref") {
    await ack();
    const link = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME ?? "quantniumaibot"}?start=ref_${chatId}`;
    const count = await prisma.botUser.count({ where: { referredBy: chatId } });
    const me = await prisma.botUser.findUnique({ where: { id: user.id }, select: { referralEarned: true } });
    return void editMessage(
      chatId, msgId!,
      pick(lang, "<b>🎁 Referral</b>\nShare your link — earn 30% of the platform fee from every trade your referrals make.", "<b>🎁 邀请</b>\n分享你的链接——从你邀请的交易者的每笔手续费中赚取 30%。") +
        `\n\n${pick(lang, "Referrals", "已邀请")}: <b>${count}</b>\n${pick(lang, "Earned", "已赚取")}: <b>${(me?.referralEarned ?? 0).toFixed(5)} ${nativeSym(user.chain as ChainId)}</b>` +
        `\n\n<code>${link}</code>`,
      [[{ text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }]],
    );
  }
  if (data === "sigsub") {
    await ack();
    const me = await prisma.botUser.findUnique({ where: { id: user.id }, select: { signalsOn: true, signalMinScore: true } });
    const { text, keyboard } = signalsScreen(lang, me?.signalsOn ?? false, me?.signalMinScore ?? 70);
    return void editMessage(chatId, msgId!, text, keyboard);
  }
  if (data === "sigtoggle") {
    const me = await prisma.botUser.findUnique({ where: { id: user.id }, select: { signalsOn: true, signalMinScore: true } });
    const on = !(me?.signalsOn ?? false);
    await prisma.botUser.update({ where: { id: user.id }, data: { signalsOn: on } });
    await ack(on ? pick(lang, "Signals on", "信号已开启") : pick(lang, "Signals off", "信号已关闭"));
    const { text, keyboard } = signalsScreen(lang, on, me?.signalMinScore ?? 70);
    return void editMessage(chatId, msgId!, text, keyboard);
  }
  if (data.startsWith("sigscore:")) {
    const n = Number(data.slice(9));
    await prisma.botUser.update({ where: { id: user.id }, data: { signalMinScore: n } });
    await ack();
    const me = await prisma.botUser.findUnique({ where: { id: user.id }, select: { signalsOn: true } });
    const { text, keyboard } = signalsScreen(lang, me?.signalsOn ?? false, n);
    return void editMessage(chatId, msgId!, text, keyboard);
  }
  // one-tap buy from a pushed signal
  if (data.startsWith("sig:")) {
    const [, chain, addr] = data.split(":");
    const ch = asChain(chain as EvmChainId);
    if (ch !== user.chain as EvmChainId) await prisma.botUser.update({ where: { id: user.id }, data: { chain: ch } });
    await ack(pick(lang, "Loading…", "加载中…"));
    const token = await resolveToken(ch, addr);
    if (!token) return void sendMessage(chatId, pick(lang, "Couldn't load that token.", "无法加载该代币。"));
    await setState(user.id, { mode: "buy", token });
    const address = (await walletAddressFor(user.id, user.chain as ChainId)) ?? "";
    const bal = await nativeBalanceFor(user.id, ch as ChainId, address);
    const { text, keyboard } = buyCard(lang, ch as ChainId, token, bal);
    return void sendMessage(chatId, text, keyboard);
  }
  // orders
  if (data === "orders") { await ack(); return await showOrders(user, chatId, msgId); }
  if (data.startsWith("ord_cancel:")) {
    await cancelOrder(user.id, data.slice(11));
    await ack(pick(lang, "Cancelled", "已取消"));
    return await showOrders(user, chatId, msgId);
  }
  if (data === "limitbuy") {
    const st = (user.state ?? null) as State;
    await ack();
    await setState(user.id, { mode: "buy", token: st?.token, awaiting: "limitBuy" });
    return void sendMessage(chatId, pick(lang, "Send: <price> <amount>  — buy when price drops to that level.\ne.g.  0.0000012 0.1", "发送：<价格> <金额>  — 价格跌到该水平时买入。\n例如  0.0000012 0.1"));
  }
  if (data === "tpsl") {
    const st = (user.state ?? null) as State;
    await ack();
    await setState(user.id, { mode: "sell", token: st?.token, awaiting: "tpsl" });
    return void sendMessage(chatId, pick(lang, "Send: <take-profit%> <stop-loss%>  — auto-sell 100% at those moves.\ne.g.  50 30", "发送：<止盈%> <止损%>  — 到达时自动全部卖出。\n例如  50 30"));
  }
  if (data === "limitsell") {
    const st = (user.state ?? null) as State;
    await ack();
    await setState(user.id, { mode: "sell", token: st?.token, awaiting: "limitSell" });
    return void sendMessage(chatId, pick(lang, "Send: <price> <percent>  — sell when price rises to that level.\ne.g.  0.00005 100", "发送：<价格> <百分比>  — 价格涨到该水平时卖出。\n例如  0.00005 100"));
  }
  if (data === "buyprompt") { await ack(); return void sendMessage(chatId, pick(lang, "Paste the token contract address (0x…) you want to buy.", "粘贴你想买入的代币合约地址（0x…）。")); }

  // wallet key ops
  if (data === "exp") {
    /*
      Export the key for the chain in use. The two are different formats for
      different wallets — handing someone a hex key for their Solana address
      would look like an export and import into nothing.
    */
    const isSol = user.chain === "sol";
    const pk = isSol ? await exportSolanaKey(user.id) : await exportPrivateKey(user.id);
    await ack(pick(lang, "Sent privately — delete after saving.", "已私密发送——保存后请删除。"), true);
    if (pk)
      await sendMessage(
        chatId,
        `🔑 <b>${pick(lang, "Private key", "私钥")}</b> · ${chainName(user.chain as ChainId)}\n<code>${pk}</code>\n\n⚠️ ${pick(lang, "Anyone with this key controls the wallet. Never share it. Delete this message.", "拥有此私钥者即可控制钱包。切勿分享，请删除此消息。")}`,
      );
    return;
  }
  if (data === "imp") { await ack(); await setState(user.id, { awaiting: "importKey" }); return void sendMessage(chatId, pick(lang, "Send the private key to import (it replaces your bot wallet).", "发送要导入的私钥（将替换你的机器人钱包）。")); }

  // buy flow
  if (data === "buyrefresh") {
    await ack();
    const state = (user.state ?? null) as State;
    if (!state?.token) return;
    const fresh = await resolveToken(user.chain as ChainId, state.token.address);
    if (!fresh) return;
    await setState(user.id, { mode: "buy", token: fresh });
    const address = (await walletAddressFor(user.id, user.chain as ChainId)) ?? "";
    const bal = await nativeBalanceFor(user.id, user.chain as ChainId, address);
    const { text, keyboard } = buyCard(lang, user.chain as ChainId, fresh, bal);
    return void editMessage(chatId, msgId!, text, keyboard);
  }
  if (data === "amt:custom") { await ack(); const st = (user.state ?? null) as State; await setState(user.id, { mode: "buy", token: st?.token, awaiting: "buyAmount" }); return void sendMessage(chatId, pick(lang, "Type the amount to spend, e.g. 0.1", "输入买入金额，例如 0.1")); }
  if (data.startsWith("amt:")) {
    const amount = Number(data.slice(4));
    const st = (user.state ?? null) as State;
    if (!st?.token) { await ack(); return; }
    await ack(pick(lang, "Submitting…", "提交中…"));
    return await doBuy(user, chatId, st.token, amount);
  }

  // positions + sell
  if (data === "p") { await ack(); return await showPositions(user, chatId, msgId); }
  if (data.startsWith("sellpick:")) {
    await ack();
    const addr = data.slice(9);
    const token = await resolveToken(user.chain as ChainId, addr);
    if (!token) return;
    await setState(user.id, { mode: "sell", token });
    const kb: Keyboard = [
      [25, 50, 100].map((pct) => ({ text: `${pct}%`, data: `sell:${pct}` })),
      [
        { text: pick(lang, "🎯 TP / SL", "🎯 止盈/止损"), data: "tpsl" },
        { text: pick(lang, "⏳ Limit sell", "⏳ 限价卖出"), data: "limitsell" },
      ],
      [{ text: pick(lang, "‹ Back", "‹ 返回"), data: "p" }],
    ];
    return void editMessage(chatId, msgId!, `<b>${pick(lang, "Sell", "卖出")} ${token.symbol}</b>\n${pick(lang, "Price", "价格")}: ${price(token.priceUsd)}\n\n${pick(lang, "Choose how much to sell, or set an automatic order:", "选择卖出比例，或设置自动订单：")}`, kb);
  }
  if (data.startsWith("sell:")) {
    const pct = Number(data.slice(5));
    const st = (user.state ?? null) as State;
    if (!st?.token) { await ack(); return; }
    await ack(pick(lang, "Submitting…", "提交中…"));
    return await doSell(user, chatId, st.token, pct);
  }
}

async function doBuy(user: BotUserRow, chatId: string, token: ResolvedToken, amount: number) {
  const lang = user.lang as Lang;
  if (token.honeypot) { await sendMessage(chatId, pick(lang, "🚫 Blocked — this token is a honeypot (you can't sell it).", "🚫 已拦截——此代币为貔貅（无法卖出）。")); return; }
  const account = await getAccount(user.id);
  if (!account) { await sendMessage(chatId, "Wallet error."); return; }
  await sendMessage(chatId, `⏳ ${pick(lang, "Buying", "买入")} ${token.symbol} · ${amount} ${nativeSym(user.chain as ChainId)}…`);
  const res = await buyFor(user.id, user.chain as ChainId, token.address, amount, user.slippageBps, token.decimals);
  if (!res.ok) { await sendMessage(chatId, `❌ ${res.error}`); return; }
  await recordTrade(user, token, "BUY", res.amountToken, res.amountNative);
  await creditReferral(user.id, res.amountNative);
  await sendMessage(
    chatId,
    `✅ <b>${pick(lang, "Bought", "已买入")} ${token.symbol}</b>\n${res.amountToken.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token.symbol} · ${amount} ${nativeSym(user.chain as ChainId)}\n<a href="${txUrl(user.chain as ChainId, res.txHash)}">${pick(lang, "view tx", "查看交易")}</a>`,
    [[{ text: pick(lang, "📊 Positions", "📊 持仓"), data: "p" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]],
  );
}

async function doSell(user: BotUserRow, chatId: string, token: ResolvedToken, pct: number) {
  const lang = user.lang as Lang;
  const held = await heldFor(user.id, user.chain as ChainId, token.address);
  if (!(held > 0)) { await sendMessage(chatId, pick(lang, "Nothing to sell.", "没有可卖出的持仓。")); return; }
  await sendMessage(chatId, `⏳ ${pick(lang, "Selling", "卖出")} ${pct}% ${token.symbol}…`);
  const res = await sellFor(user.id, user.chain as ChainId, token.address, pct, user.slippageBps);
  if (!res.ok) { await sendMessage(chatId, `❌ ${res.error}`); return; }
  await recordTrade(user, token, "SELL", res.amountToken, res.amountNative);
  await creditReferral(user.id, res.amountNative);
  await sendMessage(
    chatId,
    `✅ <b>${pick(lang, "Sold", "已卖出")} ${token.symbol}</b>\n+${res.amountNative.toFixed(5)} ${nativeSym(user.chain as ChainId)}\n<a href="${txUrl(user.chain as ChainId, res.txHash)}">${pick(lang, "view tx", "查看交易")}</a>`,
    [[{ text: pick(lang, "📊 Positions", "📊 持仓"), data: "p" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]],
  );
}

async function showPositions(user: BotUserRow, chatId: string, msgId?: number) {
  const lang = user.lang as Lang;
  const trades = await prisma.botTrade.findMany({ where: { botUserId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  // net token quantity per token on the active chain
  const byToken = new Map<string, { symbol: string; qtyBuy: number; qtySell: number; costUsd: number }>();
  for (const t of trades) {
    if (t.chain !== user.chain as EvmChainId) continue;
    const e = byToken.get(t.tokenAddress) ?? { symbol: t.symbol, qtyBuy: 0, qtySell: 0, costUsd: 0 };
    if (t.side === "BUY") { e.qtyBuy += t.amountToken; e.costUsd += t.amountToken * t.priceUsd; }
    else e.qtySell += t.amountToken;
    byToken.set(t.tokenAddress, e);
  }
  const open = [...byToken.entries()].filter(([, e]) => e.qtyBuy - e.qtySell > 0.0000001);
  if (open.length === 0) {
    const text = pick(lang, "<b>📊 Positions</b>\nNo open positions on this chain.", "<b>📊 持仓</b>\n此链上暂无持仓。");
    const kb: Keyboard = [[{ text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]];
    return void (msgId ? editMessage(chatId, msgId, text, kb) : sendMessage(chatId, text, kb));
  }
  const nativeUsd = await getNativeUsd();
  // price PnL in the chain's own token — quoting a Solana position in ETH
  // gives a number that looks precise and is simply wrong
  const px =
    user.chain === "bsc" ? nativeUsd.bnb : user.chain === "sol" ? nativeUsd.sol : nativeUsd.eth;
  let text = pick(lang, "<b>📊 Positions</b>\n", "<b>📊 持仓</b>\n");
  const rows: Keyboard = [];
  for (const [addr, e] of open) {
    // the on-chain balance for whichever chain the position is on; the trade
    // ledger is the fallback when the chain can't be read
    const onChain = await heldFor(user.id, user.chain as ChainId, addr).catch(() => 0);
    const held = { amount: onChain > 0 ? onChain : e.qtyBuy - e.qtySell };
    const tok = await resolveToken(user.chain as ChainId, addr);
    const valUsd = tok ? held.amount * tok.priceUsd : 0;
    const pnlUsd = valUsd - e.costUsd;
    const emoji = tok?.score != null ? scoreEmoji(tok.score) : "⚪";
    text += `\n${emoji} <b>${e.symbol}</b> · ${held.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n   ${valUsd > 0 ? `≈ ${valUsd.toFixed(2)} USD` : ""} · PnL ${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} (${px > 0 ? (pnlUsd / px).toFixed(4) : "0"} ${nativeSym(user.chain as ChainId)})`;
    rows.push([{ text: `${pick(lang, "Sell", "卖出")} ${e.symbol}`, data: `sellpick:${addr}` }]);
  }
  rows.push([{ text: pick(lang, "↻ Refresh", "↻ 刷新"), data: "p" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]);
  return void (msgId ? editMessage(chatId, msgId, text, rows) : sendMessage(chatId, text, rows));
}

async function showOrders(user: BotUserRow, chatId: string, msgId?: number) {
  const lang = user.lang as Lang;
  const orders = await listOrders(user.id);
  if (orders.length === 0) {
    const text = pick(lang, "<b>📋 Orders</b>\nNo active orders.\n\nSet limit buys from a buy card, or TP/SL from a position.", "<b>📋 订单</b>\n暂无活动订单。\n\n在买入卡设置限价买入，或在持仓设置止盈/止损。");
    const kb: Keyboard = [[{ text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]];
    return void (msgId ? editMessage(chatId, msgId, text, kb) : sendMessage(chatId, text, kb));
  }
  const label: Record<string, string> = {
    LIMIT_BUY: pick(lang, "Limit buy", "限价买入"),
    LIMIT_SELL: pick(lang, "Limit sell", "限价卖出"),
    TP: pick(lang, "Take-profit", "止盈"),
    SL: pick(lang, "Stop-loss", "止损"),
  };
  let text = pick(lang, "<b>📋 Active orders</b>\n", "<b>📋 活动订单</b>\n");
  const rows: Keyboard = [];
  for (const o of orders) {
    const size = o.kind === "LIMIT_BUY" ? `${o.sizeNative} ${nativeSym(o.chain as ChainId)}` : `${o.pct}%`;
    text += `\n${o.kind === "SL" ? "🛑" : o.kind === "TP" ? "🎯" : "⏳"} <b>${o.symbol}</b> · ${label[o.kind]} @ ${price(o.triggerUsd)} · ${size}${o.status === "FILLING" ? " ⏳" : ""}`;
    rows.push([{ text: `✕ ${o.symbol} ${label[o.kind]}`, data: `ord_cancel:${o.id}` }]);
  }
  rows.push([{ text: pick(lang, "↻ Refresh", "↻ 刷新"), data: "orders" }, { text: pick(lang, "‹ Menu", "‹ 菜单"), data: "m" }]);
  return void (msgId ? editMessage(chatId, msgId, text, rows) : sendMessage(chatId, text, rows));
}

async function recordTrade(user: BotUserRow, token: ResolvedToken, side: "BUY" | "SELL", amountToken: number, amountNative: number) {
  await prisma.botTrade.create({
    data: {
      botUserId: user.id,
      chain: user.chain as EvmChainId,
      tokenAddress: token.address,
      symbol: token.symbol,
      side,
      amountToken,
      amountNative,
      priceUsd: token.priceUsd,
    },
  }).catch(() => {});
}

async function setState(botUserId: string, state: State) {
  await prisma.botUser.update({ where: { id: botUserId }, data: { state: (state ?? undefined) as never } });
}

function txUrl(chain: ChainId, hash: string): string {
  const base =
    chain === "bsc"
      ? "https://bscscan.com/tx/"
      : chain === "base"
        ? "https://basescan.org/tx/"
        : chain === "sol"
          ? "https://solscan.io/tx/"
          : chain === "rh"
            ? "https://robinhoodchain.blockscout.com/tx/"
            : "https://etherscan.io/tx/";
  return base + hash;
}
