import { prisma } from "@/lib/db";
import { publicClient, ERC20_ABI } from "@/lib/dex";
import { fetchRugChecks, rugcheckSupported } from "@/lib/datasources/honeypot";
import type { ChainId, EvmChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

/*
  Resolve a pasted contract address into everything the buy card needs — price,
  liquidity, and (the Quant AI edge) the safety score + risk flags. Checks the
  indexed catalog first; falls back to a live GeckoTerminal pool lookup so any
  fresh token is still tradeable, with a live rug-check to flag honeypots.
*/
export type ResolvedToken = {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  fdvUsd: number;
  change24h: number;
  score: number | null; // null = not yet rated by the engine
  flags: string[];
  honeypot: boolean;
  decimals: number;
  indexed: boolean;
};

const GT = "https://api.geckoterminal.com/api/v2";
const GT_NET: Record<ChainId, string> = { eth: "eth", bsc: "bsc", base: "base", rh: "robinhood", sol: "solana" };
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/*
  The catalog doesn't populate decimals (everything defaults to 18), so ask the
  contract. Sizing a trade with the wrong decimals is off by powers of ten.
*/
async function onChainDecimals(chain: ChainId, address: string, fallback: number): Promise<number> {
  try {
    const d = await publicClient(chain as EvmChainId).readContract({
      address: address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    return Number(d) || fallback;
  } catch {
    return fallback;
  }
}

export async function resolveToken(chain: ChainId, addressInput: string): Promise<ResolvedToken | null> {
  /*
    Solana mints are base58 and carry case, so they're kept verbatim; only the
    EVM path lowercases. Lowercasing a mint yields an address that matches no
    token, which reads to the user as "the bot doesn't know this coin".
  */
  const raw = addressInput.trim();
  const isSol = chain === "sol";
  const address = isSol ? raw : raw.toLowerCase();
  if (isSol) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;

  // 1) indexed catalog — full score + flags. Blacklisted tokens resolve to
  // nothing, so the bot can't quote or buy them.
  const row = await prisma.token.findFirst({
    where: { chain: chain.toUpperCase() as Chain, address, blacklisted: false },
  });
  const banned = await prisma.token.findFirst({
    where: { chain: chain.toUpperCase() as Chain, address, blacklisted: true },
    select: { id: true },
  });
  if (banned) return null;
  if (row) {
    const m = (row.market ?? {}) as { priceUsd?: number; priceChange24h?: number };
    return {
      chain,
      address,
      symbol: row.symbol,
      name: row.name,
      priceUsd: num(m.priceUsd),
      liquidityUsd: row.liquidityUsd,
      fdvUsd: row.marketCapUsd,
      change24h: num(m.priceChange24h),
      score: row.currentScore,
      flags: row.flags,
      honeypot: row.flags.includes("HONEYPOT_RISK") || row.flags.includes("RUG_RISK"),
      decimals: await onChainDecimals(chain as EvmChainId, address, row.decimals),
      indexed: true,
    };
  }

  // 2) live GeckoTerminal top pool — unrated but tradeable
  try {
    const r = await fetch(`${GT}/networks/${GT_NET[chain]}/tokens/${address}/pools?page=1`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const p = j?.data?.[0]?.attributes;
    if (!p) return null;

    // live honeypot / tax check where supported (ETH/BSC)
    let honeypot = false;
    let flags: string[] = [];
    if (rugcheckSupported(chain as EvmChainId)) {
      const rc = await fetchRugChecks(chain as EvmChainId, [address]).catch(() => new Map());
      const hp = rc.get(address);
      if (hp) {
        honeypot = hp.isHoneypot;
        if (hp.isHoneypot) flags.push("HONEYPOT_RISK");
        if (Math.max(hp.buyTaxPct, hp.sellTaxPct) > 10) flags.push("HIGH_TAX");
      }
    } else {
      flags = ["UNVERIFIED"];
    }

    const [symbol, name] = String(p.name ?? "").split("/").map((x: string) => x.trim());
    return {
      chain,
      address,
      symbol: symbol || "?",
      name: name || symbol || "?",
      priceUsd: num(p.base_token_price_usd),
      liquidityUsd: num(p.reserve_in_usd),
      fdvUsd: num(p.fdv_usd),
      change24h: num(p.price_change_percentage?.h24),
      score: null,
      flags,
      honeypot,
      decimals: await onChainDecimals(chain as EvmChainId, address, 18),
      indexed: false,
    };
  } catch {
    return null;
  }
}
