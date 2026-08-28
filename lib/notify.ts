import { prisma } from "./db";
import { sendTelegram, isLinkedEndpoint } from "./telegram";
import type { NotificationKind } from "./generated/prisma/enums";

/*
  One entry point for user notifications: writes the in-app Notification and
  fans out to the user's linked channels (Telegram today). Never throws —
  notifying must not break the flow that triggered it.
*/
export async function notifyUser(
  userId: string,
  kind: NotificationKind,
  title: string,
  body: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: { userId, kind, title, body, meta: (meta ?? {}) as never },
    });
    const tg = await prisma.alertChannel.findUnique({
      where: { userId_type: { userId, type: "TELEGRAM" } },
    });
    if (tg?.enabled && isLinkedEndpoint(tg.endpoint)) {
      await sendTelegram(tg.endpoint!, `<b>${title}</b>\n${body}`);
    }
  } catch (e) {
    console.error("notifyUser failed:", (e as Error).message);
  }
}

/* Batch variant — same content to many users, used by signal fan-out. */
export async function notifyUsers(
  userIds: string[],
  kind: NotificationKind,
  title: string,
  body: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        kind,
        title,
        body,
        meta: (meta ?? {}) as never,
      })),
    });
    const channels = await prisma.alertChannel.findMany({
      where: { userId: { in: userIds }, type: "TELEGRAM", enabled: true },
    });
    await Promise.all(
      channels
        .filter((c) => isLinkedEndpoint(c.endpoint))
        .map((c) => sendTelegram(c.endpoint!, `<b>${title}</b>\n${body}`)),
    );
  } catch (e) {
    console.error("notifyUsers failed:", (e as Error).message);
  }
}
