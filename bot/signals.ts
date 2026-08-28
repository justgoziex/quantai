import { prisma } from "@/lib/db";
import type { ChainId } from "@/lib/chains";
import { sendMessage } from "./telegram";
import { pick, scoreEmoji, chainName, type Lang } from "./menu";

/*
  Push high-conviction ENTRY signals to subscribed bot users with a one-tap
  buy button. Opt-in per user (signalsOn) with a personal minimum score.
*/
type Sig = { chain: ChainId; address: string; symbol: string; score: number; type: string; reasoning: string };

export async function pushSignalsToBotUsers(signals: Sig[]): Promise<void> {
  const entries = signals.filter((s) => s.type === "ENTRY" && s.score >= 60);
  if (entries.length === 0) return;
  const subs = await prisma.botUser.findMany({
    where: { signalsOn: true },
    select: { chatId: true, lang: true, signalMinScore: true },
  });
  if (subs.length === 0) return;

  for (const s of entries) {
    const recipients = subs.filter((u) => s.score >= u.signalMinScore);
    if (recipients.length === 0) continue;
    for (const u of recipients) {
      const lang = u.lang as Lang;
      const text =
        `${scoreEmoji(s.score)} <b>${pick(lang, "Signal", "信号")}: ${s.symbol}</b> · ${chainName(s.chain)}\n` +
        `${pick(lang, "Quant AI score", "Quant AI 评分")} <b>${s.score}/100</b>\n${s.reasoning.slice(0, 180)}`;
      await sendMessage(u.chatId, text, [
        [{ text: pick(lang, `💰 Buy ${s.symbol}`, `💰 买入 ${s.symbol}`), data: `sig:${s.chain}:${s.address}` }],
      ]).catch(() => {});
    }
  }
}
