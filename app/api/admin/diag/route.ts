import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { fetchSolanaSecurityFast, solanaFastSecurityAvailable } from "@/lib/datasources/solana-security";
import { fetchSolanaRugChecks } from "@/lib/datasources/honeypot";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
  GET /api/admin/diag — what the screening engine can actually reach from
  inside a production function.

  Reports which upstreams are configured (booleans only, never key values) and
  then runs a real read against live tokens, so a silent failure shows up as
  data rather than as an empty result nobody can explain.
*/
export async function GET(req: Request) {
  const res = await requireAdmin(req);
  if ("error" in res) return res.error;

  const configured = {
    helius: Boolean(process.env.HELIUS_API_KEY),
    birdeye: Boolean(process.env.BIRDEYE_API_KEY),
    quicknode: Boolean(process.env.QUICKNODE_SOLANA_RPC),
    fastPathAvailable: solanaFastSecurityAvailable(),
  };

  // three real Solana tokens with liquidity, straight from the catalogue
  const sample = await prisma.token.findMany({
    where: { chain: "SOL", blacklisted: false, liquidityUsd: { gte: 5_000 } },
    orderBy: { liquidityUsd: "desc" },
    take: 3,
    select: { symbol: true, address: true },
  });
  const mints = sample.map((s) => s.address);

  const t0 = Date.now();
  const [sec, rug] = await Promise.all([
    fetchSolanaSecurityFast(mints).catch((e) => ({ error: String(e).slice(0, 120) }) as never),
    fetchSolanaRugChecks(mints).catch(() => new Map()),
  ]);
  const ms = Date.now() - t0;

  const secMap = sec instanceof Map ? sec : new Map();
  const results = sample.map((s) => {
    const x = secMap.get(s.address);
    return {
      symbol: s.symbol,
      securityRead: Boolean(x),
      holders: x?.holderCount ?? null,
      top10Pct: x?.top10SharePct ?? null,
      mintable: x?.mintable ?? null,
      freezable: x?.cannotSellAll ?? null,
      rugRead: rug.has(s.address),
    };
  });

  return NextResponse.json({
    configured,
    sampled: mints.length,
    securityReads: secMap.size,
    rugReads: rug.size,
    elapsedMs: ms,
    results,
  });
}
