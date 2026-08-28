import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, auditLog } from "@/lib/admin";
import { badRequest } from "@/lib/api";
import { getChannelConfig } from "@/lib/config";
import { buildCallCard, type CallToken } from "@/bot/channel";
import { postToChannel } from "@/bot/telegram";
import { CHAINS, type ChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

/*
  POST /api/admin/channel — render a call card for a real token so the desk can
  see exactly what the channel will get.

  action "preview" only renders; "test" also posts it to the configured channel,
  which is the quickest way to confirm the bot has permission to post there.
  Neither one records a ChannelCall, so a test never blocks the real call or
  starts milestone tracking.
*/
export async function POST(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    chain?: string;
    address?: string;
  } | null;

  const action = body?.action === "test" ? "test" : "preview";
  const chain = String(body?.chain ?? "eth").toLowerCase() as ChainId;
  if (!CHAINS[chain]) return badRequest("Unknown chain.");
  // base58 mints carry case; hex addresses don't
  const raw = String(body?.address ?? "").trim();
  const address = chain === "sol" ? raw : raw.toLowerCase();
  const valid =
    chain === "sol"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
      : /^0x[0-9a-f]{40}$/.test(address);
  if (!valid) return badRequest("Enter a valid contract address.");

  const row = await prisma.token.findFirst({
    where: { chain: chain.toUpperCase() as Chain, address },
    select: {
      symbol: true,
      name: true,
      currentScore: true,
      liquidityUsd: true,
      marketCapUsd: true,
      dex: true,
      pairCreatedAt: true,
      market: true,
    },
  });

  /*
    Indexed tokens render from the stored snapshot. Anything else falls back to a
    live pool read, so the desk can preview any contract — including one the
    engine hasn't rated yet, which shows 评分 as "—" rather than a fake 0.
  */
  let token: CallToken;
  if (row) {
    const m = (row.market ?? {}) as Record<string, number | undefined>;
    token = {
      chain,
      address,
      symbol: row.symbol,
      name: row.name,
      score: row.currentScore,
      priceUsd: Number(m.priceUsd ?? 0),
      mcapUsd: row.marketCapUsd,
      liquidityUsd: row.liquidityUsd,
      dex: row.dex ?? "",
      pairCreatedAt: row.pairCreatedAt,
      creatorPct: m.creatorPct == null ? null : Number(m.creatorPct),
      rows: [
        { label: "5M", change: Number(m.priceChange5m ?? 0), volume: Number(m.volume5mUsd ?? 0), buys: Number(m.buys5m ?? 0), sells: Number(m.sells5m ?? 0) },
        { label: "1H", change: Number(m.priceChange1h ?? 0), volume: Number(m.volume1hUsd ?? 0), buys: Number(m.buys1h ?? 0), sells: Number(m.sells1h ?? 0) },
        { label: "1D", change: Number(m.priceChange24h ?? 0), volume: Number(m.volume24hUsd ?? 0), buys: Number(m.buys24h ?? 0), sells: Number(m.sells24h ?? 0) },
      ],
    };
  } else {
    const live = await livePool(chain, address);
    if (!live) {
      return NextResponse.json(
        { error: `No pool found for that address on ${CHAINS[chain].name}. Check the chain.` },
        { status: 404 },
      );
    }
    token = live;
  }

  const cfg = await getChannelConfig();
  const card = await buildCallCard(token, cfg);

  let posted = false;
  if (action === "test") {
    if (!cfg.chatId) return badRequest("Set the channel first, then send a test.");
    const id = await postToChannel(cfg.chatId, card.text, { keyboard: card.keyboard });
    posted = id !== null;
    await auditLog(res.user.id, "channel.test", "PlatformConfig", "channelCalls", {
      chain,
      address,
      chatId: cfg.chatId,
      posted,
    });
    if (!posted) {
      return NextResponse.json(
        {
          error:
            "Telegram rejected the post. Check the bot is an admin of that channel and the id is right.",
          text: card.text,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    posted,
    indexed: Boolean(row),
    text: card.text,
    keyboard: card.keyboard,
  });
}

const GT = "https://api.geckoterminal.com/api/v2";
const GT_NET: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/*
  Live top pool for an address the catalog doesn't carry. Same source the
  screener ingests from, so the numbers match what a call would show — only the
  score is missing, because scoring is the engine's job, not a preview's.
*/
async function livePool(chain: ChainId, address: string): Promise<CallToken | null> {
  try {
    const r = await fetch(`${GT}/networks/${GT_NET[chain]}/tokens/${address}/pools?page=1`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const p = (await r.json().catch(() => null))?.data?.[0];
    const a = p?.attributes;
    if (!a) return null;

    const [symbol] = String(a.name ?? "").split("/").map((x: string) => x.trim());
    const created = a.pool_created_at ? new Date(String(a.pool_created_at)) : null;

    return {
      chain,
      address,
      symbol: symbol || "?",
      name: symbol || "?",
      score: null, // unrated — the card shows "—"
      priceUsd: num(a.base_token_price_usd),
      mcapUsd: num(a.fdv_usd),
      liquidityUsd: num(a.reserve_in_usd),
      dex: String(p.relationships?.dex?.data?.id ?? "").replace(/_/g, " "),
      pairCreatedAt: created && !Number.isNaN(created.getTime()) ? created : null,
      creatorPct: null,
      rows: [
        {
          label: "5M",
          change: num(a.price_change_percentage?.m5),
          volume: num(a.volume_usd?.m5),
          buys: num(a.transactions?.m5?.buys),
          sells: num(a.transactions?.m5?.sells),
        },
        {
          label: "1H",
          change: num(a.price_change_percentage?.h1),
          volume: num(a.volume_usd?.h1),
          buys: num(a.transactions?.h1?.buys),
          sells: num(a.transactions?.h1?.sells),
        },
        {
          label: "1D",
          change: num(a.price_change_percentage?.h24),
          volume: num(a.volume_usd?.h24),
          buys: num(a.transactions?.h24?.buys),
          sells: num(a.transactions?.h24?.sells),
        },
      ],
    };
  } catch {
    return null;
  }
}
