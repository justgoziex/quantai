import type { TokenSecurity } from "./goplus";

/*
  Fast Solana security read — Helius RPC + Birdeye, in place of GoPlus.

  GoPlus answers one address per request and does not batch, which is why every
  Solana token sat at the provisional score cap: the queue could never drain.
  These sources answer the same questions far faster, so a token can get the
  full ten-gate read in the pass it's discovered rather than days later.

    mint / freeze authority   → RPC getAccountInfo      (the Solana rug vectors)
    holder concentration      → RPC getTokenLargestAccounts + owner lookup
    holder count              → Birdeye token_overview
    LP locked                 → rugcheck.xyz (called separately by the caller)
*/

const HELIUS = process.env.HELIUS_API_KEY ?? "";
/*
  QuickNode returns 100 largest accounts where Helius returns 20, which makes
  concentration far more accurate once pool accounts are excluded — so it takes
  the indexed reads when configured, and Helius covers everything else.
*/
const QUICKNODE = process.env.QUICKNODE_SOLANA_RPC ?? "";
const BIRDEYE = process.env.BIRDEYE_API_KEY ?? "";

export const heliusRpc = (): string =>
  HELIUS
    ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}`
    : (process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com");

export const solanaFastSecurityAvailable = (): boolean => Boolean(HELIUS || QUICKNODE);

/* The endpoint for holder/concentration reads — deepest result set wins. */
const indexedRpc = (): string => QUICKNODE || heliusRpc();

/*
  Programs that own liquidity-pool token accounts. A pool holds a large share of
  supply by design — counting it as a whale would make every healthy token look
  dangerously concentrated, which is the opposite of the truth.
*/
const AMM_OWNERS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca v1
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora pools
]);

/* Burn and incinerator addresses — supply that is gone, not held. */
const BURN_OWNERS = new Set([
  "1nc1nerator11111111111111111111111111111111",
  "11111111111111111111111111111111",
]);

type Rpc = { result?: unknown; error?: { message?: string } };

/*
  One RPC call, with retry.

  Firing a whole wave at once gets a share of it rate-limited, and returning
  null on the first refusal meant those tokens were quietly dropped — the batch
  looked like it ran while covering a third of what it was given. A refusal is
  a "come back shortly", not an answer, so it's worth waiting out.
*/
async function rpc<T>(
  method: string,
  params: unknown[],
  endpoint?: string,
  attempt = 0,
): Promise<T | null> {
  try {
    const r = await fetch(endpoint ?? heliusRpc(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) + Math.random() * 250));
      return rpc<T>(method, params, endpoint, attempt + 1);
    }
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as Rpc | null;
    // a rate-limit can also arrive as a JSON-RPC error on a 200
    if (j?.error && /rate|limit|busy|exceeded/i.test(j.error.message ?? "") && attempt < 3) {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) + Math.random() * 250));
      return rpc<T>(method, params, endpoint, attempt + 1);
    }
    return (j?.result as T) ?? null;
  } catch {
    if (attempt < 2) {
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
      return rpc<T>(method, params, endpoint, attempt + 1);
    }
    return null;
  }
}

/*
  Holder count.

  Measured against the live catalogue, the indexer answers for every token
  while the market-data source answers for well under half — and where both
  answer they agree exactly. So the indexer leads and the other is the
  fallback, which took holder coverage from a minority of Solana tokens to
  effectively all of them.

  Two honest caveats, both acceptable for a gate that asks "is this held by a
  real base or by three wallets": this counts token accounts rather than
  unique owners (one owner can hold several, though for memecoins it's close
  to one each), and it stops at a page, so a very widely held token reports
  the page size rather than its true total. Both err toward understating, and
  a gate that understates is the safe direction.
*/
const HOLDER_PAGE = 1_000;

async function indexerHolders(mint: string): Promise<number> {
  if (!HELIUS) return 0;
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccounts",
        params: { mint, limit: HOLDER_PAGE, options: { showZeroBalance: false } },
      }),
      signal: AbortSignal.timeout(9_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json().catch(() => null)) as
      | { result?: { token_accounts?: unknown[] } }
      | null;
    return j?.result?.token_accounts?.length ?? 0;
  } catch {
    return 0;
  }
}

/* Fallback holder count, for when the indexer can't answer. */
async function birdeyeHolders(mint: string): Promise<number> {
  if (!BIRDEYE) return 0;
  try {
    const r = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, {
      headers: { "X-API-KEY": BIRDEYE, "x-chain": "solana", accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json().catch(() => null)) as { data?: { holder?: number } } | null;
    return Number(j?.data?.holder ?? 0) || 0;
  } catch {
    return 0;
  }
}

type LargestAccount = { address: string; amount: string; uiAmount: number | null };

/*
  Top-10 share of circulating supply, with pool and burn accounts removed.
  Returns null when the data isn't good enough to judge, so the scorer can fall
  back rather than act on a wrong number.
*/
async function concentration(mint: string): Promise<{ top10: number; each: number[] } | null> {
  const [largest, supply] = await Promise.all([
    rpc<{ value: LargestAccount[] }>("getTokenLargestAccounts", [mint], indexedRpc()),
    rpc<{ value: { amount: string; decimals: number } }>("getTokenSupply", [mint]),
  ]);
  const accounts = largest?.value ?? [];
  const total = Number(supply?.value?.amount ?? 0);
  if (accounts.length === 0 || total <= 0) return null;

  // resolve who owns each account so pools can be excluded
  const owners = await rpc<{
    value: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[];
  }>("getMultipleAccounts", [accounts.slice(0, 30).map((a) => a.address), { encoding: "jsonParsed" }], indexedRpc());

  const held: number[] = [];
  accounts.slice(0, 30).forEach((a, i) => {
    const owner = owners?.value?.[i]?.data?.parsed?.info?.owner ?? "";
    if (AMM_OWNERS.has(owner) || BURN_OWNERS.has(owner)) return; // liquidity, not a holder
    const share = (Number(a.amount) / total) * 100;
    if (Number.isFinite(share) && share > 0) held.push(share);
  });

  const each = held.slice(0, 10);
  return { top10: each.reduce((s, x) => s + x, 0), each };
}

/*
  The full security picture for one mint, shaped like the EVM read so the
  existing ten-gate scorer needs no Solana special-casing.
*/
export async function fetchSolanaSecurityFast(
  mints: string[],
): Promise<Map<string, TokenSecurity>> {
  const out = new Map<string, TokenSecurity>();
  // QuickNode alone is enough — requiring Helius specifically meant a
  // perfectly working configuration returned nothing at all
  if (mints.length === 0 || (!HELIUS && !QUICKNODE)) return out;

  /*
    Concurrency tuned for how much actually comes back, not how fast the batch
    finishes. Twenty at a time returned in seconds but the provider refused
    roughly half of it, so the pass "succeeded" having read a fraction of what
    it was given — the slowest possible way to make progress. Eight, with the
    retry above, reads nearly all of it.
  */
  const CONCURRENCY = 8;
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    const wave = mints.slice(i, i + CONCURRENCY);
    await Promise.all(
      wave.map(async (mint) => {
        const [info, conc] = await Promise.all([
          rpc<{
            value: { data?: { parsed?: { info?: { mintAuthority?: string | null; freezeAuthority?: string | null } } } } | null;
          }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]),
          concentration(mint).catch(() => null),
        ]);

        const parsed = info?.value?.data?.parsed?.info;
        if (!parsed) return; // not a mint we can read — leave it to the slow path

        /*
          No concentration reading means no verdict. Reporting it as zero would
          be read by the scorer as flawless distribution and hand the token full
          marks on the holders gate — inventing a high score out of data we
          never obtained. Leave it to the slow path instead.
        */
        if (!conc) return;

        const mintable = Boolean(parsed.mintAuthority);
        const freezable = Boolean(parsed.freezeAuthority);

        out.set(mint, {
          address: mint,
          // a mint can't be a honeypot in the EVM sense; freezing is the
          // equivalent trap and is reported through cannotSellAll
          isHoneypot: false,
          cannotSellAll: freezable,
          buyTaxPct: 0,
          sellTaxPct: 0,
          mintable,
          openSource: true, // Solana programs aren't per-token source
          renounced: !mintable && !freezable,
          holderCount: 0, // filled by the holder pass below
          top10SharePct: conc.top10,
          topHolders: conc.each,
          lpLockedPct: 0, // filled by the rug check, which reads the LP directly
          creatorPct: 0,
        });
      }),
    );
    if (i + CONCURRENCY < mints.length) await new Promise((r) => setTimeout(r, 40));
  }

  /*
    Holder counts come from a rate-limited source, so they get their own gentler
    pass instead of riding along in the wide RPC wave — at twenty at a time it
    throttled and returned zero for almost everything, which read on the site as
    "no holders" for tokens that plainly had them.
  */
  const readable = [...out.keys()];
  const HOLDER_CONCURRENCY = 4;
  for (let i = 0; i < readable.length; i += HOLDER_CONCURRENCY) {
    await Promise.all(
      readable.slice(i, i + HOLDER_CONCURRENCY).map(async (mint) => {
        let n = await indexerHolders(mint).catch(() => 0);
        if (n === 0) n = await birdeyeHolders(mint).catch(() => 0);
        const rec = out.get(mint);
        if (rec && n > 0) rec.holderCount = n;
      }),
    );
    if (i + HOLDER_CONCURRENCY < readable.length) await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

/*
  Holder counts for tokens that were already scored.

  Once a token has had its full read it is never re-queued — that's what keeps
  the screening backlog moving. But it also means a token scored before holder
  counts were reliable keeps a zero forever, showing "0 holders" on a coin that
  plainly has them. This tops those up without disturbing the queue.
*/
export async function backfillHolderCounts(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0 || !HELIUS) return out;
  const CONCURRENCY = 6;
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    await Promise.all(
      mints.slice(i, i + CONCURRENCY).map(async (mint) => {
        let n = await indexerHolders(mint).catch(() => 0);
        if (n === 0) n = await birdeyeHolders(mint).catch(() => 0);
        if (n > 0) out.set(mint, n);
      }),
    );
    if (i + CONCURRENCY < mints.length) await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}
