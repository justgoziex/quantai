import { NextResponse } from "next/server";
import { badRequest } from "@/lib/api";
import { getMonetization } from "@/lib/config";

export const dynamic = "force-dynamic";

/*
  Swap routing proxy — powers the trade panel's buy/sell on ETH & BSC by
  routing through an aggregator (all DEX versions: Uniswap V2/V3/V4, Pancake,
  etc.). The API key stays server-side and the provider is never named to the
  client. The platform fee is applied here (collected in the native leg) and
  never itemized to the user. Robinhood isn't covered by the aggregator — the
  client falls back to its verified V2 router when this returns unsupported.

  mode=price → indicative estimate (no taker, no tx). mode=quote → firm quote
  with a ready-to-sign transaction (requires taker).
*/
const AGG_BASE = "https://api.0x.org/swap/allowance-holder";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const CHAIN_ID: Record<string, number> = { eth: 1, bsc: 56, base: 8453 };

export async function GET(req: Request, { params }: { params: { chain: string } }) {
  const chain = params.chain.toLowerCase();
  const chainId = CHAIN_ID[chain];
  const key = process.env.ZEROX_API_KEY;

  // no key or unsupported chain → client uses its own router
  if (!chainId || !key) return NextResponse.json({ supported: false });

  const url = new URL(req.url);
  const sellToken = url.searchParams.get("sellToken");
  const buyToken = url.searchParams.get("buyToken");
  const sellAmount = url.searchParams.get("sellAmount");
  const taker = url.searchParams.get("taker") ?? undefined;
  const mode = url.searchParams.get("mode") === "quote" ? "quote" : "price";
  const slippageBps = url.searchParams.get("slippageBps") ?? "300";
  if (!sellToken || !buyToken || !sellAmount) return badRequest("Missing swap parameters.");
  if (mode === "quote" && !taker) return badRequest("A wallet address is required to execute.");

  const mon = await getMonetization();
  const feeOn = /^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet) && mon.swapFeeBps > 0;

  const q = new URLSearchParams({
    chainId: String(chainId),
    sellToken,
    buyToken,
    sellAmount,
    slippageBps,
  });
  if (taker) q.set("taker", taker);
  if (feeOn) {
    q.set("swapFeeRecipient", mon.feeWallet);
    q.set("swapFeeBps", String(mon.swapFeeBps));
    // fee is taken in the native leg (sellToken on buys, buyToken on sells)
    q.set("swapFeeToken", sellToken.toLowerCase() === NATIVE.toLowerCase() ? sellToken : buyToken);
  }

  try {
    const r = await fetch(`${AGG_BASE}/${mode}?${q.toString()}`, {
      headers: { "0x-api-key": key, "0x-version": "v2" },
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      const msg = j?.data?.details?.[0]?.description ?? j?.reason ?? "No route for this pair.";
      return NextResponse.json({ supported: true, ok: false, error: msg }, { status: 200 });
    }
    // liquidity check
    if (j.liquidityAvailable === false) {
      return NextResponse.json({ supported: true, ok: false, error: "No liquidity route for this token." });
    }
    return NextResponse.json({
      supported: true,
      ok: true,
      buyAmount: j.buyAmount,
      minBuyAmount: j.minBuyAmount ?? j.buyAmount,
      transaction: j.transaction ?? null,
      allowance: j.issues?.allowance ?? null, // { actual, spender } when approval needed
    });
  } catch (e) {
    return NextResponse.json({ supported: true, ok: false, error: (e as Error).message.slice(0, 120) });
  }
}
