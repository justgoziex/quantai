/*
  Thin Telegram Bot API client for the trading bot. All calls are best-effort
  and time-bounded; nothing here throws into the webhook handler.
*/
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

export const botConfigured = Boolean(TOKEN);

export type Button = { text: string; data?: string; url?: string };
export type Keyboard = Button[][];

function markup(keyboard?: Keyboard) {
  if (!keyboard) return undefined;
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? " " })),
    ),
  };
}

async function call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9_000),
    });
    const j = await r.json().catch(() => null);
    return (j?.result as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/*
  Channel posts get their own sender. The shared `call` gives up after 9s and
  swallows the reason, which cost us two calls whose message ids came back null
  even though Telegram may have delivered them — and a null id means later gain
  milestones can't thread onto the original. This waits longer, honours a 429's
  retry_after, retries once, and logs what actually went wrong.
*/
async function callChannel(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!TOKEN) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await r.json().catch(() => null)) as
        | { ok?: boolean; description?: string; parameters?: { retry_after?: number }; result?: unknown }
        | null;

      if (j?.ok) return (j.result as Record<string, unknown>) ?? null;

      const wait = j?.parameters?.retry_after;
      console.error(`[telegram] ${method} failed: ${j?.description ?? "no body"}${wait ? ` (retry_after ${wait}s)` : ""}`);
      // flood control: wait it out once, but never longer than the function has
      if (wait && wait <= 10 && attempt === 0) {
        await new Promise((res) => setTimeout(res, wait * 1000));
        continue;
      }
      // a rejected message won't succeed on a retry — only network faults will
      if (j?.description) return null;
    } catch (e) {
      console.error(`[telegram] ${method} threw: ${(e as Error).message}`);
    }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 1_200));
  }
  return null;
}

export function sendMessage(chatId: string | number, text: string, keyboard?: Keyboard) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: markup(keyboard),
  });
}

/*
  Post to a channel and hand back the message id. Channel calls keep that id so
  a later gain milestone can be threaded as a reply to the original call, and
  `replyTo` is what posts those replies. Link previews stay on for calls — the
  token's own image makes the card look right in the channel.
*/
export async function postToChannel(
  chatId: string | number,
  text: string,
  opts: { keyboard?: Keyboard; replyTo?: number; preview?: boolean } = {},
): Promise<number | null> {
  const res = await callChannel("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: !opts.preview,
    reply_markup: markup(opts.keyboard),
    ...(opts.replyTo ? { reply_to_message_id: opts.replyTo } : {}),
  });
  const id = res?.message_id;
  return typeof id === "number" ? id : null;
}

export function editMessage(chatId: string | number, messageId: number, text: string, keyboard?: Keyboard) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: markup(keyboard),
  });
}

export function answerCallback(id: string, text?: string, alert = false) {
  return call("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
}
