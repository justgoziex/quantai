import type { Keyboard } from "./telegram";
import type { ResolvedToken } from "./token";
import type { ChainId } from "@/lib/chains";

/*
  Screen builders — each returns HTML text + an inline keyboard, in the user's
  language. Kept together so copy lives next to layout.
*/
export type Lang = "en" | "zh";
export const pick = (lang: Lang, en: string, zh: string) => (lang === "zh" ? zh : en);

export const nativeSym = (chain: ChainId) => (chain === "bsc" ? "BNB" : chain === "sol" ? "SOL" : "ETH");
export const chainName = (chain: ChainId) =>
  chain === "eth" ? "Ethereum" : chain === "bsc" ? "BNB Chain" : chain === "base" ? "Base" : chain === "sol" ? "Solana" : "Robinhood";

export const usd = (n: number) =>
  n >= 1 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : n > 0 ? `$${n.toPrecision(3)}` : "$0";
export function price(p: number): string {
  if (p <= 0) return "$0";
  if (p >= 0.01) return `$${p.toPrecision(4)}`;
  const s = p.toFixed ? p.toFixed(20) : String(p);
  const m = s.match(/^0\.(0+)([1-9]\d{0,2})/);
  return m ? `$0.0(${m[1].length})${m[2]}` : `$${p.toExponential(2)}`;
}
const amt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

/* ── main menu ── */
export function mainMenu(lang: Lang, chain: ChainId, address: string, balance: number): { text: string; keyboard: Keyboard } {
  const text =
    pick(lang, "<b>⚡ Quant AI Trading</b>", "<b>⚡ Quant AI 交易</b>") +
    "\n" +
    pick(lang, "Safety-scored sniping on ETH · BNB · Robinhood.", "在 ETH · BNB · Robinhood 上安全评分狙击。") +
    `\n\n${pick(lang, "Chain", "链")}: <b>${chainName(chain)}</b>` +
    `\n${pick(lang, "Wallet", "钱包")}: <code>${address}</code>` +
    `\n${pick(lang, "Balance", "余额")}: <b>${amt(balance)} ${nativeSym(chain)}</b>` +
    `\n\n${pick(lang, "Paste a token contract address to buy.", "粘贴代币合约地址即可买入。")}`;
  const keyboard: Keyboard = [
    [
      { text: pick(lang, "💰 Buy", "💰 买入"), data: "buyprompt" },
      { text: pick(lang, "📊 Positions", "📊 持仓"), data: "p" },
    ],
    [
      { text: pick(lang, "📋 Orders", "📋 订单"), data: "orders" },
      { text: pick(lang, "👛 Wallet", "👛 钱包"), data: "w" },
    ],
    [
      { text: pick(lang, "🔔 Signals", "🔔 信号"), data: "sigsub" },
      { text: pick(lang, "⚙️ Settings", "⚙️ 设置"), data: "s" },
    ],
    [
      { text: `🔗 ${chainName(chain)}`, data: "chainmenu" },
      { text: pick(lang, "🎁 Referral", "🎁 邀请"), data: "ref" },
    ],
    [
      { text: lang === "zh" ? "🌐 EN" : "🌐 中文", data: "lang" },
      { text: pick(lang, "↻ Refresh", "↻ 刷新"), data: "m" },
    ],
  ];
  return { text, keyboard };
}

/* ── wallet ── */
export function walletScreen(lang: Lang, chain: ChainId, address: string, balance: number): { text: string; keyboard: Keyboard } {
  const text =
    pick(lang, "<b>👛 Your wallet</b>", "<b>👛 你的钱包</b>") +
    `\n\n<code>${address}</code>\n` +
    pick(lang, "Tap to copy. Deposit ", "点击复制。向此地址充值 ") +
    `<b>${nativeSym(chain)}</b>` +
    pick(lang, " to this address to trade.", " 即可交易。") +
    `\n\n${pick(lang, "Balance", "余额")}: <b>${amt(balance)} ${nativeSym(chain)}</b>` +
    `\n\n⚠️ ${pick(lang, "This wallet is custodial — keep only what you're trading here. Export your key to move funds out.", "此钱包为托管钱包——仅存放用于交易的资金。导出私钥可转出资金。")}`;
  const keyboard: Keyboard = [
    [{ text: pick(lang, "🔑 Export private key", "🔑 导出私钥"), data: "exp" }],
    [{ text: pick(lang, "📥 Import a wallet", "📥 导入钱包"), data: "imp" }],
    [{ text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }],
  ];
  return { text, keyboard };
}

/* ── chain switcher ── */
export function chainMenu(lang: Lang, chain: ChainId): { text: string; keyboard: Keyboard } {
  const row = (c: ChainId) => ({ text: `${c === chain ? "✅ " : ""}${chainName(c)}`, data: `chain:${c}` });
  return {
    text: pick(lang, "<b>Choose a chain</b>", "<b>选择链</b>"),
    keyboard: [[row("eth")], [row("bsc")], [row("base")], [row("sol")], [row("rh")], [{ text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }]],
  };
}

/* ── buy card (safety-scored) ── */
export function buyCard(lang: Lang, chain: ChainId, t: ResolvedToken, balance: number): { text: string; keyboard: Keyboard } {
  const scoreLine =
    t.score !== null
      ? `${scoreEmoji(t.score)} ${pick(lang, "Quant AI score", "Quant AI 评分")}: <b>${t.score}/100</b>`
      : `⚪ ${pick(lang, "Not yet rated", "尚未评分")}`;
  const flagLine = t.flags.length ? `\n⚠️ ${t.flags.map(flagLabel).filter(Boolean).join(" · ")}` : "";
  const warn = t.honeypot
    ? `\n\n🚫 <b>${pick(lang, "HONEYPOT — you likely can't sell this. Do not buy.", "貔貅（蜜罐）——你可能无法卖出。请勿买入。")}</b>`
    : t.score !== null && t.score < 40
      ? `\n\n⚠️ <b>${pick(lang, "Low safety score — high risk.", "安全评分低——高风险。")}</b>`
      : "";

  const text =
    `<b>${t.symbol}</b> · ${chainName(chain)}\n` +
    `${scoreLine}${flagLine}\n\n` +
    `${pick(lang, "Price", "价格")}: <b>${price(t.priceUsd)}</b>  (${t.change24h >= 0 ? "+" : ""}${t.change24h.toFixed(1)}% 24h)\n` +
    `${pick(lang, "Liquidity", "流动性")}: ${usd(t.liquidityUsd)}\n` +
    `${pick(lang, "Your balance", "你的余额")}: ${amt(balance)} ${nativeSym(chain)}` +
    warn +
    `\n\n${pick(lang, "Choose an amount to buy:", "选择买入金额：")}`;

  const presets =
    chain === "eth" ? [0.01, 0.05, 0.1, 0.25] : chain === "sol" ? [0.1, 0.5, 1, 2] : [0.05, 0.2, 0.5, 1];
  const keyboard: Keyboard = [
    presets.slice(0, 2).map((v) => ({ text: `${v} ${nativeSym(chain)}`, data: `amt:${v}` })),
    presets.slice(2).map((v) => ({ text: `${v} ${nativeSym(chain)}`, data: `amt:${v}` })),
    [
      { text: pick(lang, "✏️ Custom", "✏️ 自定义"), data: "amt:custom" },
      { text: pick(lang, "⏳ Limit buy", "⏳ 限价买入"), data: "limitbuy" },
    ],
    [{ text: pick(lang, "↻ Refresh", "↻ 刷新"), data: "buyrefresh" }, { text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }],
  ];
  return { text, keyboard };
}

/* ── settings ── */
export function settingsScreen(lang: Lang, slippageBps: number): { text: string; keyboard: Keyboard } {
  const opt = (bps: number) => ({ text: `${bps === slippageBps ? "✅ " : ""}${bps / 100}%`, data: `slip:${bps}` });
  return {
    text:
      pick(lang, "<b>⚙️ Settings</b>", "<b>⚙️ 设置</b>") +
      `\n\n${pick(lang, "Slippage tolerance", "滑点容忍度")}: <b>${slippageBps / 100}%</b>`,
    keyboard: [
      [opt(100), opt(300), opt(500), opt(1000)],
      [{ text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }],
    ],
  };
}

/* ── signals subscription ── */
export function signalsScreen(lang: Lang, on: boolean, minScore: number): { text: string; keyboard: Keyboard } {
  const text =
    pick(lang, "<b>🔔 Signal alerts</b>", "<b>🔔 信号提醒</b>") +
    `\n\n${pick(lang, "Get high-conviction ENTRY signals with a one-tap buy button, straight here.", "在这里接收高置信度买入信号，一键买入。")}` +
    `\n\n${pick(lang, "Status", "状态")}: <b>${on ? pick(lang, "ON", "已开启") : pick(lang, "OFF", "已关闭")}</b>` +
    `\n${pick(lang, "Minimum score", "最低评分")}: <b>${minScore}</b>`;
  const scoreOpt = (n: number) => ({ text: `${n === minScore ? "✅ " : ""}${n}+`, data: `sigscore:${n}` });
  return {
    text,
    keyboard: [
      [{ text: on ? pick(lang, "🔕 Turn off", "🔕 关闭") : pick(lang, "🔔 Turn on", "🔔 开启"), data: "sigtoggle" }],
      [scoreOpt(50), scoreOpt(70), scoreOpt(85)],
      [{ text: pick(lang, "‹ Back", "‹ 返回"), data: "m" }],
    ],
  };
}

export function scoreEmoji(score: number): string {
  return score >= 70 ? "🟢" : score >= 40 ? "🟡" : "🔴";
}
function flagLabel(f: string): string {
  const map: Record<string, string> = {
    HONEYPOT_RISK: "Honeypot",
    RUG_RISK: "Rug risk",
    HIGH_TAX: "High tax",
    MINT_OPEN: "Mint open",
    SELL_TRAP: "Sell trap",
    UNVERIFIED: "Unverified",
    RUGCHECKED: "Rug-checked ✓",
    LP_LOCKED: "LP locked ✓",
  };
  return map[f] ?? "";
}
