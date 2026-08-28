import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import { fetchPool } from "@/lib/datasources/geckoterminal";
import { fetchTokenSecurity } from "@/lib/datasources/goplus";
import { upsertScoredToken } from "@/lib/ingest";
import type { Chain } from "@/lib/generated/prisma/enums";
import { CHAIN_LIST, normalizeAddress, type ChainId } from "@/lib/chains";
import { fetchSolanaSecurityFast } from "@/lib/datasources/solana-security";

export const dynamic = "force-dynamic";

/*
  POST /api/refresh/[chain]/[address] — refresh ONE token from live sources.
  Keeps detail pages current between full ingest passes. Skips when the
  token was updated in the last 20 seconds.
*/
export async function POST(
  _req: Request,
  { params }: { params: { chain: string; address: string } },
) {
  if (!dbConfigured) return dbUnavailable();
  const chainId = params.chain.toLowerCase() as ChainId;
  if (!CHAIN_LIST.some((c) => c.id === chainId)) return badRequest("Unknown chain.");
  /*
    Normalise per chain. Solana mints are base58 and carry case — the blanket
    lowercase here meant a Solana token page looked up an address that matches
    nothing, so opening one never refreshed it. Base was excluded outright for
    no reason beyond the check never being updated when the chain was added.
  */
  const address = normalizeAddress(chainId, params.address);

  const token = await prisma.token.findUnique({
    where: { chain_address: { chain: chainId.toUpperCase() as Chain, address } },
    select: { pairAddress: true, updatedAt: true },
  });
  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  if (Date.now() - new Date(token.updatedAt).getTime() < 20_000) {
    return NextResponse.json({ ok: true, skipped: "fresh" });
  }
  if (!token.pairAddress) return NextResponse.json({ ok: true, skipped: "no pool" });

  const pool = await fetchPool(chainId, token.pairAddress);
  if (!pool) return NextResponse.json({ ok: true, skipped: "pool unavailable" });

  /*
    Solana has its own security read — the EVM one can't answer for a mint, and
    calling it would quietly return nothing and downgrade a good token to its
    provisional score just because someone opened its page.
  */
  const security = await (chainId === "sol"
    ? fetchSolanaSecurityFast([address])
    : fetchTokenSecurity(chainId, [address])
  ).catch(() => new Map<string, never>());
  const outcome = await upsertScoredToken(chainId, { ...pool, tokenAddress: address }, security.get(address));

  return NextResponse.json({ ok: true, outcome });
}
