/*
  Holder counts for chains with no security provider.

  Robinhood Chain had no coverage at all from the security or market-data
  vendors — nearly three thousand tokens carried no holder figure, the one
  number that says whether a token is held by a community or by its deployer
  and two friends. Ethereum and Base had counts, but sparse and sometimes
  implausible ones.

  These explorers publish the figure directly, which is a better source than
  any vendor: it reads the chain rather than an index of it. Where both exist
  the explorer wins — it reported PEPE at 571,175 holders and DEGEN at
  1,227,227, against vendor readings in the single digits for tokens of the
  same standing.
*/

const EXPLORER: Partial<Record<string, string>> = {
  rh: "https://robinhoodchain.blockscout.com",
  eth: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  /*
    BNB Chain has no public explorer of this kind and the commercial API keeps
    holder counts behind a paid tier, so it stays on the security provider's
    figure — which arrives with the full screening read rather than ahead of it.
  */
};

export const blockscoutSupported = (chain: string): boolean => Boolean(EXPLORER[chain]);

async function holderCount(base: string, address: string): Promise<number> {
  try {
    const r = await fetch(`${base}/api/v2/tokens/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return 0;
    const j = (await r.json().catch(() => null)) as
      | { holders?: number | string; holders_count?: number | string }
      | null;
    const raw = j?.holders ?? j?.holders_count;
    const n = Number(raw ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

/*
  Holder counts for a batch of addresses. The explorer answers one at a time,
  so this stays deliberately narrow and paced — it runs inside the ingest pass,
  and a slow loop here shows up as a slow site.
*/
export async function fetchExplorerHolders(
  chain: string,
  addresses: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const base = EXPLORER[chain];
  if (!base || addresses.length === 0) return out;

  const CONCURRENCY = 5;
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const wave = addresses.slice(i, i + CONCURRENCY);
    const counts = await Promise.all(wave.map((a) => holderCount(base, a)));
    wave.forEach((a, idx) => {
      if (counts[idx] > 0) out.set(a, counts[idx]);
    });
    if (i + CONCURRENCY < addresses.length) await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
