/*
  Wallet activity scan — what tokens has this wallet traded, and what does it
  still hold? Used by the memecoin-trader cashback flow: the snapshot is taken
  when a wallet is connected and stored on the ExternalWallet row for the
  admin to review and price.

  Sources:
   · ETHERSCAN_API_KEY set → Etherscan v2 multi-chain (ETH + BSC) token-tx log
   · no key → Blockscout public API (ETH only), keyless
*/
export type WalletActivity = {
  scannedAt: string;
  source: "etherscan" | "blockscout" | "none";
  tokens: {
    chain: "ETH" | "BSC";
    address: string;
    symbol: string;
    name: string;
    txCount: number;
    holding: boolean;
  }[];
  tradedCount: number;
  holdingCount: number;
};

const EMPTY: WalletActivity = {
  scannedAt: new Date(0).toISOString(),
  source: "none",
  tokens: [],
  tradedCount: 0,
  holdingCount: 0,
};

type TxAgg = {
  chain: "ETH" | "BSC";
  address: string;
  symbol: string;
  name: string;
  txCount: number;
  net: number; // signed token flow — positive ≈ still holding
};

async function etherscanChain(
  wallet: string,
  chainid: number,
  chain: "ETH" | "BSC",
  key: string,
): Promise<TxAgg[]> {
  const url =
    `https://api.etherscan.io/v2/api?chainid=${chainid}&module=account&action=tokentx` +
    `&address=${wallet}&page=1&offset=400&sort=desc&apikey=${key}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  const rows: Record<string, string>[] = Array.isArray(j?.result) ? j.result : [];
  const agg = new Map<string, TxAgg>();
  for (const tx of rows) {
    const addr = String(tx.contractAddress ?? "").toLowerCase();
    if (!addr) continue;
    const cur = agg.get(addr) ?? {
      chain,
      address: addr,
      symbol: String(tx.tokenSymbol ?? "?").slice(0, 12),
      name: String(tx.tokenName ?? "").slice(0, 40),
      txCount: 0,
      net: 0,
    };
    cur.txCount++;
    const decimals = Number(tx.tokenDecimal ?? 18) || 18;
    const value = Number(tx.value ?? 0) / 10 ** decimals;
    cur.net += String(tx.to ?? "").toLowerCase() === wallet.toLowerCase() ? value : -value;
    agg.set(addr, cur);
  }
  return [...agg.values()];
}

async function blockscoutEth(wallet: string): Promise<TxAgg[]> {
  // holdings (one call) + recent ERC-20 transfers (one call) — keyless
  const base = "https://eth.blockscout.com/api/v2/addresses/" + wallet;
  const [balR, txR] = await Promise.all([
    fetch(`${base}/token-balances`, { signal: AbortSignal.timeout(8_000) }).catch(() => null),
    fetch(`${base}/token-transfers?type=ERC-20`, { signal: AbortSignal.timeout(8_000) }).catch(() => null),
  ]);
  const agg = new Map<string, TxAgg>();

  if (txR?.ok) {
    const j = await txR.json().catch(() => null);
    const items: Record<string, unknown>[] = Array.isArray(j?.items) ? j.items : [];
    for (const it of items) {
      const tok = (it.token ?? {}) as Record<string, string>;
      const addr = String(tok.address ?? "").toLowerCase();
      if (!addr) continue;
      const cur = agg.get(addr) ?? {
        chain: "ETH" as const,
        address: addr,
        symbol: String(tok.symbol ?? "?").slice(0, 12),
        name: String(tok.name ?? "").slice(0, 40),
        txCount: 0,
        net: 0,
      };
      cur.txCount++;
      agg.set(addr, cur);
    }
  }
  if (balR?.ok) {
    const j = await balR.json().catch(() => null);
    const items: Record<string, unknown>[] = Array.isArray(j) ? j : [];
    for (const it of items) {
      const tok = (it.token ?? {}) as Record<string, string>;
      const addr = String(tok.address ?? "").toLowerCase();
      if (!addr) continue;
      const cur = agg.get(addr) ?? {
        chain: "ETH" as const,
        address: addr,
        symbol: String(tok.symbol ?? "?").slice(0, 12),
        name: String(tok.name ?? "").slice(0, 40),
        txCount: 0,
        net: 0,
      };
      cur.net = Number((it as Record<string, string>).value ?? 1) || 1; // any balance → holding
      agg.set(addr, cur);
    }
  }
  return [...agg.values()];
}

export async function fetchWalletActivity(wallet: string): Promise<WalletActivity> {
  try {
    const key = process.env.ETHERSCAN_API_KEY;
    let aggs: TxAgg[] = [];
    let source: WalletActivity["source"] = "none";
    if (key) {
      const [eth, bsc] = await Promise.all([
        etherscanChain(wallet, 1, "ETH", key).catch(() => []),
        etherscanChain(wallet, 56, "BSC", key).catch(() => []),
      ]);
      aggs = [...eth, ...bsc];
      source = "etherscan";
    } else {
      aggs = await blockscoutEth(wallet).catch(() => []);
      source = "blockscout";
    }
    const tokens = aggs
      .sort((a, b) => b.txCount - a.txCount)
      .slice(0, 40)
      .map((a) => ({
        chain: a.chain,
        address: a.address,
        symbol: a.symbol,
        name: a.name,
        txCount: a.txCount,
        holding: a.net > 0,
      }));
    return {
      scannedAt: new Date().toISOString(),
      source,
      tokens,
      tradedCount: aggs.length,
      holdingCount: tokens.filter((t) => t.holding).length,
    };
  } catch {
    return EMPTY;
  }
}
