import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, auditLog } from "@/lib/admin";
import { badRequest } from "@/lib/api";
import { CHAINS, normalizeAddress, type ChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

/* GET /api/admin/tokens?q= — search tokens by symbol/name/address. */
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const tokens = await prisma.token.findMany({
    where: q
      ? {
          OR: [
            { symbol: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            /*
              Match the address however it's written.

              Lowercasing the query is right for EVM, where addresses are
              stored lowercased, and wrong for Solana, where a base58 mint
              carries case — searching one returned nothing, so a Solana token
              couldn't be found and therefore couldn't be blacklisted at all.
              Case-insensitive covers both without having to guess the chain.
            */
            { address: { contains: q, mode: "insensitive" } },
          ],
        }
      : { blacklisted: true }, // default view: current blacklist
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      chain: true,
      address: true,
      symbol: true,
      name: true,
      currentScore: true,
      liquidityUsd: true,
      flags: true,
      blacklisted: true,
      blacklistReason: true,
      category: true,
      promoted: true,
    },
  });
  return NextResponse.json({ tokens });
}

/* POST /api/admin/tokens — blacklist, recategorize, delete, clear AI cache. */
export async function POST(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const { tokenId, action, reason, category, days, chain, address } = (await req
    .json()
    .catch(() => ({}))) as {
    tokenId?: string;
    chain?: string;
    address?: string;
    action?:
      | "blacklistAddress"
      | "blacklist"
      | "unblacklist"
      | "recategorize"
      | "delete"
      | "clearAiCache"
      | "promote"
      | "unpromote";
    reason?: string;
    category?: string;
    days?: number;
  };
  /*
    Ban an address that was never listed.

    Every other action edits an existing row, which meant a token the desk
    wanted kept out could only be banned after it had already appeared. That
    gap widened once any visitor could pull a token in by opening its page:
    there was no way to refuse one in advance.

    The ban is recorded as a token row flagged blacklisted, because that flag
    is what every read path already filters on — a separate list would have to
    be threaded through each of them, and the one that got missed would serve
    the token.
  */
  if (action === "blacklistAddress") {
    if (!chain || !address) return badRequest("chain and address are required.");
    if (!reason?.trim()) return badRequest("A reason is required to blacklist a token.");

    const chainId = chain.toLowerCase();
    if (!(chainId in CHAINS)) return badRequest("Unknown chain.");

    // base58 keeps its case; EVM addresses are lowercased
    const addr = normalizeAddress(chainId as ChainId, address.trim());
    if (!addr) return badRequest("That address doesn't look valid for this chain.");

    const chainEnum = chainId.toUpperCase() as Chain;
    const existing = await prisma.token.findFirst({
      where: { chain: chainEnum, address: addr },
      select: { id: true, symbol: true },
    });

    const row = existing
      ? await prisma.token.update({
          where: { id: existing.id },
          data: { blacklisted: true, blacklistReason: reason.trim() },
        })
      : await prisma.token.create({
          data: {
            chain: chainEnum,
            address: addr,
            // placeholders: nothing is known about a token that never listed
            name: "Blocked token",
            symbol: "BLOCKED",
            marketCapUsd: 0,
            blacklisted: true,
            blacklistReason: reason.trim(),
          },
        });

    await auditLog(res.user.id, "token.blacklistAddress", "Token", row.id, {
      chain: chainEnum,
      address: addr,
      preemptive: !existing,
      reason: reason.trim(),
    });
    return NextResponse.json({ ok: true, preemptive: !existing, id: row.id });
  }

  if (!tokenId || !action) return badRequest("tokenId and action are required.");

  if (action === "promote" || action === "unpromote") {
    const until =
      action === "promote"
        ? new Date(Date.now() + Math.max(1, Number(days) || 7) * 86_400_000)
        : null;
    const token = await prisma.token.update({
      where: { id: tokenId },
      data: { promoted: action === "promote", promotedUntil: until },
    });
    await auditLog(res.user.id, `token.${action}`, "Token", tokenId, {
      symbol: token.symbol,
      until: until?.toISOString() ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const token = await prisma.token.delete({ where: { id: tokenId } }).catch(() => null);
    await auditLog(res.user.id, "token.delete", "Token", tokenId, { symbol: token?.symbol ?? null });
    return NextResponse.json({ ok: true });
  }

  if (action === "recategorize") {
    if (!["new", "trending", "lookup"].includes(category ?? "")) {
      return badRequest("category must be new, trending, or lookup.");
    }
    await prisma.token.update({ where: { id: tokenId }, data: { category: category! } });
    await auditLog(res.user.id, "token.recategorize", "Token", tokenId, { category: category! });
    return NextResponse.json({ ok: true });
  }

  if (action === "clearAiCache") {
    const token = await prisma.token.findUnique({ where: { id: tokenId } });
    const market = { ...((token?.market ?? {}) as Record<string, unknown>) };
    delete market.aiAnalysis;
    await prisma.token.update({
      where: { id: tokenId },
      data: { market: market as never },
    });
    await auditLog(res.user.id, "token.clearAiCache", "Token", tokenId);
    return NextResponse.json({ ok: true });
  }

  if (action === "blacklist" && !reason?.trim()) {
    return badRequest("A reason is required to blacklist a token.");
  }
  const token = await prisma.token.update({
    where: { id: tokenId },
    data:
      action === "blacklist"
        ? { blacklisted: true, blacklistReason: reason!.trim() }
        : { blacklisted: false, blacklistReason: null },
  });
  await auditLog(res.user.id, `token.${action}`, "Token", tokenId, {
    symbol: token.symbol,
    chain: token.chain,
    reason: reason ?? null,
  });
  return NextResponse.json({ ok: true });
}
