/*
  Telegram delivery — one bot, many linked accounts.
  Linking: the alerts page mints a one-time code and deep-links the user to
  t.me/<bot>?start=<code>; the webhook receives `/start <code>` and binds that
  chat id to the user's TELEGRAM AlertChannel. Delivery is a plain sendMessage.
  Unconfigured (no TELEGRAM_BOT_TOKEN) → everything no-ops gracefully.
*/
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const API = `https://api.telegram.org/bot${TOKEN}`;

export const telegramConfigured = Boolean(TOKEN);

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  if (!TOKEN || !chatId) return false;
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* Linked = endpoint holds a numeric chat id (pending links hold "code:…"). */
export function isLinkedEndpoint(endpoint: string | null | undefined): boolean {
  return Boolean(endpoint && /^-?\d+$/.test(endpoint));
}
