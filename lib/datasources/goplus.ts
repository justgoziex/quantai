/*
  GoPlus Security public API (no key). One batched call per chain covers
  honeypot, taxes, mint, ownership, source verification, holders, LP lock.
  All flag values arrive as "1"/"0" strings; percents as fraction strings.
*/
import type { ChainId } from "@/lib/chains";

// GoPlus numeric chain ids. "" = unsupported (e.g. Robinhood) — callers skip.
// "" = not on the EVM endpoint. Solana is served by fetchSolanaSecurity below.
const CHAIN_ID: Record<ChainId, string> = { eth: "1", bsc: "56", base: "8453", rh: "", sol: "" };

export type TokenSecurity = {
  address: string;
  isHoneypot: boolean;
  cannotSellAll: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  mintable: boolean;
  openSource: boolean;
  renounced: boolean;
  holderCount: number;
  top10SharePct: number; // 0..100
  topHolders: number[]; // top-10 individual shares, 0..100
  lpLockedPct: number; // 0..100 of LP supply locked/burned
  creatorPct: number; // 0..100 of supply still held by the deployer
};

const DEAD = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  "",
]);

export async function fetchTokenSecurity(
  chain: ChainId,
  addresses: string[],
): Promise<Map<string, TokenSecurity>> {
  const out = new Map<string, TokenSecurity>();
  if (addresses.length === 0) return out;

  // GoPlus's batch endpoint now returns only the FIRST address per request, so
  // we query one address at a time in small concurrent waves (with retry on
  // rate-limit/empty). Callers must keep the address list bounded to respect
  // the free tier's rate budget.
  const fetchOne = async (addr: string, attempt = 0): Promise<Record<string, unknown>> => {
    try {
      const r = await fetch(
        `https://api.gopluslabs.io/api/v1/token_security/${CHAIN_ID[chain]}?contract_addresses=${addr}`,
        { headers: { accept: "application/json" }, next: { revalidate: 120 } },
      );
      if (r.status === 429 && attempt < 3) {
        await sleep(700 * (attempt + 1));
        return fetchOne(addr, attempt + 1);
      }
      if (!r.ok) return {};
      const j = await r.json().catch(() => null);
      const res: Record<string, unknown> = j?.result ?? {};
      if (Object.keys(res).length === 0 && attempt < 2) {
        await sleep(500 * (attempt + 1));
        return fetchOne(addr, attempt + 1);
      }
      return res;
    } catch {
      return {};
    }
  };

  const CONCURRENCY = 5;
  const merged: Record<string, unknown>[] = [];
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const wave = addresses.slice(i, i + CONCURRENCY);
    merged.push(...(await Promise.all(wave.map((a) => fetchOne(a)))));
    if (i + CONCURRENCY < addresses.length) await sleep(200);
  }
  const result = Object.assign({}, ...merged);

  for (const [addr, tRaw] of Object.entries(result)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = tRaw as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holders: any[] = t.holders ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lp: any[] = t.lp_holders ?? [];
    const topHolders = holders.slice(0, 10).map((h) => Number(h.percent ?? 0) * 100);
    const top10 = topHolders.reduce((s, p) => s + p, 0) / 100;
    const lpLocked = lp.reduce(
      (s, h) => s + (h.is_locked === 1 || DEAD.has(String(h.address ?? "").toLowerCase()) ? Number(h.percent ?? 0) : 0),
      0,
    );
    out.set(addr.toLowerCase(), {
      address: addr.toLowerCase(),
      isHoneypot: t.is_honeypot === "1",
      cannotSellAll: t.cannot_sell_all === "1",
      buyTaxPct: Number(t.buy_tax ?? 0) * 100,
      sellTaxPct: Number(t.sell_tax ?? 0) * 100,
      mintable: t.is_mintable === "1",
      openSource: t.is_open_source === "1",
      renounced: DEAD.has(String(t.owner_address ?? "").toLowerCase()),
      holderCount: Number(t.holder_count ?? 0),
      top10SharePct: top10 * 100,
      topHolders,
      lpLockedPct: lpLocked * 100,
      creatorPct: Number(t.creator_percent ?? 0) * 100,
    });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/*
  Solana security — a different endpoint, a different shape, mapped onto the
  same TokenSecurity so the scoring engine needs no Solana special-casing.

  The rug vectors differ from EVM. There is no ownership to renounce and no
  approval to exploit; instead a mint can carry a live **mint authority**
  (print more supply), a **freeze authority** (freeze any holder's balance —
  a honeypot by another name), a **close authority**, or a transfer hook that
  can block a sell. Those map onto the mint/ownership/honeypot gates.
*/
export async function fetchSolanaSecurity(
  addresses: string[],
): Promise<Map<string, TokenSecurity>> {
  const out = new Map<string, TokenSecurity>();
  if (addresses.length === 0) return out;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const one = async (addr: string): Promise<any> => {
    try {
      const r = await fetch(
        `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${addr}`,
        { headers: { accept: "application/json" }, next: { revalidate: 120 } },
      );
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return (j?.result ?? {})[addr] ?? null;
    } catch {
      return null;
    }
  };

  const CONCURRENCY = 3;
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const wave = addresses.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map((a) => one(a)));
    wave.forEach((addr, idx) => {
      const t = results[idx];
      if (!t) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const on = (v: any) => String(v?.status ?? "0") === "1";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const holders: any[] = Array.isArray(t.holders) ? t.holders : [];
      const topHolders = holders.slice(0, 10).map((h) => Number(h.percent ?? 0) * 100);
      const top10 = topHolders.reduce((s, p) => s + p, 0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lp: any[] = Array.isArray(t.lp_holders) ? t.lp_holders : [];
      const lpLocked =
        lp.reduce((s, h) => s + (Number(h.is_locked) === 1 ? Number(h.percent ?? 0) : 0), 0) * 100;
      const burned = lp.reduce((s, h) => s + Number(h.burn_percent ?? 0), 0);

      // a transfer fee is Solana's tax; it applies to both directions
      const feeBps = Number(t.transfer_fee?.fee_rate ?? t.transfer_fee?.transfer_fee_rate ?? 0);
      const taxPct = Number.isFinite(feeBps) ? feeBps / 100 : 0;

      const freezable = on(t.freezable);
      const mintable = on(t.mintable);

      // base58 is case-sensitive — the mint is stored exactly as given
      out.set(addr, {
        address: addr,
        // can't be transferred at all, or a hook can veto the transfer
        isHoneypot: Number(t.non_transferable) === 1,
        // a live freeze authority can strand a holder mid-position
        cannotSellAll: freezable || (Array.isArray(t.transfer_hook) && t.transfer_hook.length > 0),
        buyTaxPct: taxPct,
        sellTaxPct: taxPct,
        mintable,
        // Solana programs aren't per-token source, so verification isn't a gate
        openSource: true,
        // the Solana equivalent of renouncing: both authorities given up
        renounced: !mintable && !freezable && !on(t.balance_mutable_authority),
        holderCount: Number(t.holder_count ?? 0),
        top10SharePct: top10,
        topHolders,
        lpLockedPct: Math.max(lpLocked, burned),
        creatorPct: 0, // GoPlus Solana reports creators, not their balance
      });
    });
    if (i + CONCURRENCY < addresses.length) await sleep(250);
  }
  return out;
}
