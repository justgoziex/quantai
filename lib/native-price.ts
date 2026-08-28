/*
  Live USD price of native gas tokens (ETH, BNB), for valuing balances and
  demo cash. Cached 60s. No key.
*/
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaef60af814a3f6f0ee75";
const WSOL = "So11111111111111111111111111111111111111112";

let cache: { at: number; eth: number; bnb: number; sol: number } | null = null;

async function priceOf(network: string, addr: string): Promise<number> {
  try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/simple/networks/${network}/token_price/${addr}`,
      { headers: { accept: "application/json" }, next: { revalidate: 60 } },
    );
    if (!r.ok) return 0;
    const j = await r.json();
    const p = j?.data?.attributes?.token_prices?.[addr];
    return Number(p) || 0;
  } catch {
    return 0;
  }
}

/*
  Fallback source. The DEX price endpoint intermittently returns no price for
  WBNB, which would value every BNB balance at zero — so we cross-check against
  a second feed whenever either leg comes back empty.
*/
async function fallbackPrices(): Promise<{ eth: number; bnb: number; sol: number }> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin,solana&vs_currencies=usd",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000), next: { revalidate: 60 } },
    );
    if (!r.ok) return { eth: 0, bnb: 0, sol: 0 };
    const j = await r.json();
    return {
      eth: Number(j?.ethereum?.usd) || 0,
      bnb: Number(j?.binancecoin?.usd) || 0,
      sol: Number(j?.solana?.usd) || 0,
    };
  } catch {
    return { eth: 0, bnb: 0, sol: 0 };
  }
}

export async function getNativeUsd(): Promise<{ eth: number; bnb: number; sol: number }> {
  if (cache && Date.now() - cache.at < 60_000) return { eth: cache.eth, bnb: cache.bnb, sol: cache.sol };
  let [eth, bnb, sol] = await Promise.all([
    priceOf("eth", WETH),
    priceOf("bsc", WBNB),
    priceOf("solana", WSOL),
  ]);
  if (!eth || !bnb || !sol) {
    const fb = await fallbackPrices();
    eth = eth || fb.eth;
    bnb = bnb || fb.bnb;
    sol = sol || fb.sol;
  }
  // keep last good values if a fetch blips to 0
  const out = { eth: eth || cache?.eth || 0, bnb: bnb || cache?.bnb || 0, sol: sol || cache?.sol || 0 };
  cache = { at: Date.now(), ...out };
  return out;
}

/*
  The USD price of a chain's gas token. Every surface that values a native
  balance goes through this, so adding a chain is one edit rather than a hunt
  for ternaries.
*/
export function nativeUsdFor(
  chain: string,
  prices: { eth: number; bnb: number; sol: number },
): number {
  const c = String(chain).toLowerCase();
  if (c === "bsc") return prices.bnb;
  if (c === "sol") return prices.sol;
  return prices.eth; // eth, base and rh all settle in ETH
}
