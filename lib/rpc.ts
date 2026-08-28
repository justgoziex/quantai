/*
  Minimal JSON-RPC reads over free public endpoints — no keys, no SDK.
  Used for the embedded wallet's native balances.
*/
import type { ChainId } from "./chains";

const RPC: Record<ChainId, string> = {
  eth: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  rh: "https://rpc.mainnet.chain.robinhood.com",
  sol: "https://solana-rpc.publicnode.com",
};

export async function getNativeBalance(
  chain: ChainId,
  address: string,
): Promise<number | null> {
  try {
    const r = await fetch(RPC[chain], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 15 },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (typeof j.result !== "string") return null;
    return Number(BigInt(j.result)) / 1e18;
  } catch {
    return null;
  }
}
