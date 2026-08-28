import { NextResponse } from "next/server";
import { fetchOhlcv, type Timeframe } from "@/lib/datasources/geckoterminal";
import { badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

const TIMEFRAMES: Timeframe[] = ["live", "15m", "1h", "6h", "24h"];

/*
  GET /api/ohlcv/[chain]/[pool]?tf=15m — candle proxy so the detail page can
  paint instantly and load chart data client-side (GeckoTerminal, 60s cache).
*/
export async function GET(
  req: Request,
  { params }: { params: { chain: string; pool: string } },
) {
  const chain = params.chain.toLowerCase();
  if (!["eth", "bsc", "base", "rh", "sol"].includes(chain)) return badRequest("Unknown chain.");
  const tfParam = new URL(req.url).searchParams.get("tf") as Timeframe | null;
  const tf: Timeframe = tfParam && TIMEFRAMES.includes(tfParam) ? tfParam : "15m";
  /*
    Solana pool addresses are base58 and case-sensitive — lowercasing one asks
    the upstream for a pool that doesn't exist, so the chart comes back empty.
  */
  const pool = chain === "sol" ? params.pool : params.pool.toLowerCase();
  const candles = await fetchOhlcv(chain as never, pool, tf).catch(() => []);
  // CDN-cache 15s so concurrent viewers of one chart share a single upstream
  // fetch while the chart still feels live (client polls every 15s).
  return NextResponse.json(
    { candles },
    { headers: { "cache-control": "public, max-age=15, s-maxage=15, stale-while-revalidate=45" } },
  );
}
