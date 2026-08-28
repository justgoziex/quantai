import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runIngest } from "@/lib/ingest";
import { prisma, dbConfigured } from "@/lib/db";
import { sendTelegram } from "@/lib/telegram";
import { handleBotUpdate } from "@/bot/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  Telegram bot webhook. Registered with a shared secret in the URL
  (?secret=TELEGRAM_WEBHOOK_SECRET) so only Telegram's calls are accepted.

  Commands:
   /start <code> — link this chat to the Quant AI account that minted <code>
   /price <symbol|0xaddress> — live price + signal score
   /help — what the bot does
*/
type TgUpdate = {
  message?: {
    chat?: { id?: number; type?: string };
    text?: string;
    from?: { username?: string };
  };
  /* fired when the bot is added to / removed from a channel or group */
  my_chat_member?: {
    chat?: { id?: number; title?: string; type?: string };
    new_chat_member?: { status?: string };
  };
};

export async function POST(req: Request) {
  /*
    Every bot interaction also nudges the ingest along.

    Vercel Hobby allows one cron a day, so passes are driven by traffic — and
    when the site is quiet the channel goes quiet with it, for no better reason
    than nobody happened to be looking. Bot activity is traffic too, and the
    pass is DB-locked and self-throttled, so an extra trigger costs nothing.
  */
  waitUntil(runIngest().catch(() => {}));
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const given = new URL(req.url).searchParams.get("secret") ?? "";
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!dbConfigured) return NextResponse.json({ ok: true });

  const update = (await req.json().catch(() => null)) as TgUpdate | null;

  /*
    The bot was just added to (or removed from) a chat. Recording the id here is
    the only reliable way to learn a channel's real id — the -100… number people
    copy out of a t.me/c/ link is easy to get wrong, and Telegram answers "chat
    not found" either way. The admin Channel section reads this back as the
    detected channel.
  */
  const member = update?.my_chat_member;
  if (member?.chat?.id) {
    const status = member.new_chat_member?.status ?? "";
    await prisma.platformConfig
      .upsert({
        where: { key: "channelDetected" },
        update: {
          value: {
            chatId: String(member.chat.id),
            title: member.chat.title ?? "",
            type: member.chat.type ?? "",
            status,
            at: new Date().toISOString(),
          },
        },
        create: {
          key: "channelDetected",
          value: {
            chatId: String(member.chat.id),
            title: member.chat.title ?? "",
            type: member.chat.type ?? "",
            status,
            at: new Date().toISOString(),
          },
        },
      })
      .catch(() => {});
    console.log("[telegram] my_chat_member", member.chat.id, member.chat.title, status);
    return NextResponse.json({ ok: true });
  }

  // Button taps and any non-/price message drive the trading bot. The two
  // exceptions handled here first: linking a site account (/start <linkcode>)
  // and the /price lookup command.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((update as any)?.callback_query) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cbType = (update as any).callback_query?.message?.chat?.type ?? "private";
    if (cbType !== "private") return NextResponse.json({ ok: true });
    await handleBotUpdate(update as never);
    return NextResponse.json({ ok: true });
  }

  const chatId = update?.message?.chat?.id;
  const text = (update?.message?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  /*
    The trading bot is a ONE-TO-ONE terminal. In a group or channel it must stay
    silent — otherwise it answers every member's message with "paste a contract
    address", which is exactly the spam the call channel must not produce.
    Calls are posted outward by the ingest pass, never as a reply to chatter.
  */
  const chatType = update?.message?.chat?.type ?? "private";
  if (chatType !== "private") return NextResponse.json({ ok: true });
  const chat = String(chatId);

  try {
    // /start <code> that matches a pending account link → link (not trading)
    if (text.startsWith("/start")) {
      const code = text.split(/\s+/)[1]?.trim();
      if (code && !code.startsWith("ref_")) {
        const ch = await prisma.alertChannel.findFirst({
          where: { type: "TELEGRAM", endpoint: `code:${code}` },
        });
        if (ch) {
          await prisma.alertChannel.update({
            where: { id: ch.id },
            data: { endpoint: chat, enabled: true },
          });
          await sendTelegram(
            chat,
            "✅ <b>Linked to Quant AI.</b>\nYou'll get entry/exit/risk signals for tokens on your watchlist and your price alerts, right here.\n\nOpen the trading menu with /menu.",
          );
          return NextResponse.json({ ok: true });
        }
      }
      // plain /start or a referral → the trading bot main menu
      await handleBotUpdate(update as never);
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/price")) {
      const q = text.split(/\s+/)[1]?.trim();
      if (!q) {
        await sendTelegram(chat, "Usage: <code>/price PEPE</code> or <code>/price 0x…</code>");
        return NextResponse.json({ ok: true });
      }
      // both address families, so a pasted Solana mint is recognised too
      const isAddr =
        /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
      const token = await prisma.token.findFirst({
        where: isAddr
          ? { address: q.toLowerCase() }
          : { symbol: { equals: q, mode: "insensitive" }, blacklisted: false },
        orderBy: { liquidityUsd: "desc" },
        select: {
          symbol: true,
          name: true,
          chain: true,
          address: true,
          currentScore: true,
          liquidityUsd: true,
          market: true,
        },
      });
      if (!token) {
        await sendTelegram(chat, `No token found for <code>${q.slice(0, 32)}</code>.`);
        return NextResponse.json({ ok: true });
      }
      const m = (token.market ?? {}) as { priceUsd?: number; priceChange24h?: number };
      const price = m.priceUsd
        ? m.priceUsd >= 0.01
          ? `$${m.priceUsd.toPrecision(4)}`
          : `$${m.priceUsd.toExponential(2)}`
        : "—";
      const chg = m.priceChange24h != null ? `${m.priceChange24h >= 0 ? "+" : ""}${m.priceChange24h.toFixed(1)}% 24h` : "";
      await sendTelegram(
        chat,
        `<b>${token.name} (${token.symbol})</b> · ${token.chain}\n` +
          `Price ${price} ${chg}\n` +
          `Signal score <b>${token.currentScore}/100</b> · liq $${Math.round(token.liquidityUsd).toLocaleString()}\n` +
          `https://www.quantniumai.com/token/${token.chain.toLowerCase()}/${token.address}`,
      );
      return NextResponse.json({ ok: true });
    }

    // everything else (pasted contract address, /menu, custom amounts, …)
    // is the trading bot
    await handleBotUpdate(update as never);
  } catch (e) {
    console.error("telegram webhook failed:", (e as Error).message);
  }
  return NextResponse.json({ ok: true });
}
