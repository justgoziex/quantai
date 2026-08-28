import { prisma } from "@/lib/db";
import type { ChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

/*
  Deployer scan — which tokens did this wallet actually create?

  Two complementary sources:
   1. Our own catalog — any indexed token whose creator matches (cheap, exact,
      and tells us it's ALREADY on Quant AI).
   2. Etherscan-family "contract creations" via the account txlist: contract
      deployments are txs with an empty `to` and a `contractAddress` in the
      receipt. We then keep only those that look like ERC-20s (have a symbol).

  Coverage: ETH (1), BSC (56), BASE (8453) via the Etherscan v2 multichain
  endpoint. Robinhood has no explorer API, so devs there submit the address
  manually and we verify ownership on-chain instead.
*/
const V2 = "https://api.etherscan.io/v2/api";
const EXPLORER_CHAIN: Partial<Record<ChainId, number>> = { eth: 1, bsc: 56, base: 8453 };

export type DeployedToken = {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  createdAt: string | null;
  listed: boolean; // already in the Quant AI catalog
  tokenId?: string;
  liquidityUsd?: number;
  score?: number;
};

export function deployerScanSupported(chain: ChainId): boolean {
  return chain in EXPLORER_CHAIN;
}

/* Contract addresses this wallet deployed, from the explorer's tx history. */
async function deployedContracts(chain: ChainId, wallet: string): Promise<string[]> {
  const chainid = EXPLORER_CHAIN[chain];
  const key = process.env.ETHERSCAN_API_KEY;
  if (!chainid || !key) return [];
  try {
    const url =
      `${V2}?chainid=${chainid}&module=account&action=txlist&address=${wallet}` +
      `&startblock=0&endblock=99999999&page=1&offset=2000&sort=desc&apikey=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    const rows: Record<string, string>[] = Array.isArray(j?.result) ? j.result : [];
    return rows
      .filter((tx) => !tx.to && tx.contractAddress) // contract creations
      .map((tx) => String(tx.contractAddress).toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/* Token metadata for a contract, from GeckoTerminal (works for any ERC-20). */
const GT = "https://api.geckoterminal.com/api/v2";
const GT_NET: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };

async function tokenInfo(
  chain: ChainId,
  address: string,
): Promise<{ symbol: string; name: string } | null> {
  try {
    const r = await fetch(`${GT}/networks/${GT_NET[chain]}/tokens/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!r.ok) return null;
    const a = (await r.json().catch(() => null))?.data?.attributes;
    if (!a?.symbol) return null;
    return { symbol: String(a.symbol).slice(0, 12), name: String(a.name ?? a.symbol).slice(0, 60) };
  } catch {
    return null;
  }
}

/*
  Everything this wallet deployed on one chain, annotated with whether it's
  already listed on Quant AI. Bounded: we look at the most recent deployments
  and resolve metadata for a capped number of them.
*/
export async function scanDeployedTokens(chain: ChainId, wallet: string): Promise<DeployedToken[]> {
  const addr = wallet.toLowerCase();
  const contracts = (await deployedContracts(chain, addr)).slice(0, 40);
  if (contracts.length === 0) return [];

  // which of these do we already index?
  const known = await prisma.token.findMany({
    where: { chain: chain.toUpperCase() as Chain, address: { in: contracts } },
    select: { id: true, address: true, symbol: true, name: true, liquidityUsd: true, currentScore: true, pairCreatedAt: true },
  });
  const knownByAddr = new Map(known.map((t) => [t.address, t]));

  const out: DeployedToken[] = [];
  // resolve metadata for unknown contracts, a few at a time (rate-friendly)
  const unknown = contracts.filter((c) => !knownByAddr.has(c)).slice(0, 12);
  const infos = new Map<string, { symbol: string; name: string }>();
  for (let i = 0; i < unknown.length; i += 4) {
    const wave = unknown.slice(i, i + 4);
    const res = await Promise.all(wave.map((c) => tokenInfo(chain, c)));
    wave.forEach((c, idx) => {
      const info = res[idx];
      if (info) infos.set(c, info);
    });
    if (i + 4 < unknown.length) await new Promise((r) => setTimeout(r, 250));
  }

  for (const c of contracts) {
    const k = knownByAddr.get(c);
    if (k) {
      out.push({
        chain,
        address: c,
        symbol: k.symbol,
        name: k.name,
        createdAt: k.pairCreatedAt?.toISOString() ?? null,
        listed: true,
        tokenId: k.id,
        liquidityUsd: k.liquidityUsd,
        score: k.currentScore,
      });
      continue;
    }
    const info = infos.get(c);
    if (!info) continue; // not an ERC-20 we can identify — skip
    out.push({ chain, address: c, symbol: info.symbol, name: info.name, createdAt: null, listed: false });
  }
  return out;
}
