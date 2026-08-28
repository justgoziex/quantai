import { prisma } from "./db";
import { normalizeAddress, CHAINS, type ChainId } from "./chains";
import type { Chain } from "./generated/prisma/enums";
import { fetchTokenPools } from "./datasources/geckoterminal";
import { fetchPoolsForAddresses } from "./datasources/dexscreener";
import { batchUpsertPools } from "./ingest";
import { fetchTokenSecurity } from "./datasources/goplus";
import { fetchSolanaRugChecks } from "./datasources/honeypot";

/*
  Pull one token in by address.

  The ingest sweeps ask the feeds for what is new, trending or top. A token
  that is none of those is unreachable however real it is — an established
  pair with steady volume sits below the top lists on a chain like Solana and
  aged out of "new" months ago, so nothing ever proposes it.

  This is the path for when someone already knows the address: fetch its pools
  directly, run them through the same upsert the sweeps use, and it lands
  scored and shaped identically. Discovery is the only thing that differs.
*/

export type LookupResult =
  | { ok: true; address: string; chain: ChainId }
  | { ok: false; reason: "bad-address" | "no-pools" | "blacklisted" | "failed" };

export async function lookupAndIngest(
  chainId: ChainId,
  rawAddress: string,
): Promise<LookupResult> {
  // base58 carries case; EVM does not. Getting this wrong stores a token that
  // can never be found again.
  const address = normalizeAddress(chainId, rawAddress.trim());
  if (!address) return { ok: false, reason: "bad-address" };

  const chainEnum = chainId.toUpperCase() as Chain;

  /*
    Refuse a token the desk already removed.

    Blacklisting is a flag on the row rather than a separate list, so a lookup
    that upserted first would refresh a banned token's numbers and hand it back
    looking current. Checked before any fetch, so a removed token costs nothing.
  */
  const known = await prisma.token.findFirst({
    where: { chain: chainEnum, address },
    select: { blacklisted: true },
  });
  if (known?.blacklisted) return { ok: false, reason: "blacklisted" };

  let pools = await fetchTokenPools(chainId, address).catch(() => []);

  /*
    Fall back to the second feed. The two disagree on coverage often enough
    that a token missing from one is regularly present in the other, and a
    lookup that gives up after one source fails the person who has the address
    in front of them.
  */
  if (pools.length === 0) {
    pools = await fetchPoolsForAddresses(chainId, [address]).catch(() => []);
  }

  if (pools.length === 0) return { ok: false, reason: "no-pools" };

  /*
    Exactly one pool — the deepest.

    The sweeps dedup by token before upserting, so the writer assumes one pool
    per token and simply applies them in order. Handing it four pools for the
    same token let the shallowest win: a mint with a $40k main pair was stored
    at $133 because a dust pool happened to be written last.
  */
  const mine = pools.filter((p) => p.tokenAddress === address);
  const deepest = (mine.length > 0 ? mine : pools).sort(
    (a, b) => b.liquidityUsd - a.liquidityUsd,
  )[0];
  if (!deepest) return { ok: false, reason: "no-pools" };
  const chosen = [{ ...deepest, category: "trending" as const }];

  /*
    Screen it in the same call. A token pulled in on demand and left at the
    provisional cap would show up looking worthless, which is a worse answer
    than not having it.
  */
  const security = CHAINS[chainId].securitySupported
    ? await fetchTokenSecurity(chainId, [address]).catch(() => new Map())
    : new Map();
  const rugchecks =
    chainId === "sol"
      ? await fetchSolanaRugChecks([address]).catch(() => new Map())
      : new Map();

  try {
    await batchUpsertPools(chainId, chosen, security, rugchecks);
  } catch {
    return { ok: false, reason: "failed" };
  }

  /*
    Holder count, for Solana, in the same call.

    The sweep backfills these on a schedule that only reaches tokens above its
    liquidity floor, so a token pulled in by address would otherwise sit at
    zero holders — which reads as a dead token rather than an unmeasured one.
  */
  if (chainId === "sol") {
    await (async () => {
      const { backfillHolderCounts } = await import("./datasources/solana-security");
      const counts = await backfillHolderCounts([address]).catch(() => new Map());
      const n = counts.get(address) ?? 0;
      if (n > 0) {
        await prisma.token
          .updateMany({ where: { chain: chainEnum, address }, data: { holders: n } })
          .catch(() => {});
      }
    })();
  }

  const row = await prisma.token.findFirst({
    where: { chain: chainEnum, address },
    select: { id: true },
  });
  return row ? { ok: true, address, chain: chainId } : { ok: false, reason: "failed" };
}
