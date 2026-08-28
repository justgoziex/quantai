/*
  Rug-check layer — simulation-based honeypot detection (Honeypot.is, keyless).
  Unlike registry-based security (GoPlus), this SIMULATES an actual buy+sell
  against the live contract, so it works on brand-new tokens minutes after
  deploy — the piece that lets fresh coins get real scores and signals before
  the slower registry data lands.

  Coverage: ETH (1) and BSC (56). Robinhood isn't supported.
*/
import type { ChainId } from "@/lib/chains";

const CHAIN_ID: Record<string, number> = { eth: 1, bsc: 56, base: 8453 };

export type RugCheck = {
  address: string;
  simulated: boolean; // a sell simulation actually ran
  isHoneypot: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  riskLevel: number; // 0..100-ish from the checker's own summary
  /* share of LP locked or burned, when the checker reports it (Solana) */
  lpLockedPct?: number;
};

export function rugcheckSupported(chain: ChainId): boolean {
  // Solana is covered by rugcheck.xyz rather than the EVM sell simulator
  return chain === "sol" || chain in CHAIN_ID;
}

async function checkOne(chain: ChainId, address: string): Promise<RugCheck | null> {
  try {
    const r = await fetch(
      `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${CHAIN_ID[chain]}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7_000) },
    );
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j) return null;
    const sim = j.simulationSuccess === true;
    return {
      address: address.toLowerCase(),
      simulated: sim,
      isHoneypot: j.honeypotResult?.isHoneypot === true,
      buyTaxPct: Number(j.simulationResult?.buyTax ?? 0) || 0,
      sellTaxPct: Number(j.simulationResult?.sellTax ?? 0) || 0,
      riskLevel: Number(j.summary?.riskLevel ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

/*
  Batch rug-check — one request per token, small concurrent waves so the free
  endpoint isn't hammered. Failures are simply absent from the result map.
*/
export async function fetchRugChecks(
  chain: ChainId,
  addresses: string[],
): Promise<Map<string, RugCheck>> {
  const out = new Map<string, RugCheck>();
  if (!rugcheckSupported(chain) || addresses.length === 0) return out;
  const CONCURRENCY = 5;
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const wave = addresses.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map((a) => checkOne(chain, a)));
    for (const r of results) if (r) out.set(r.address, r);
    if (i + CONCURRENCY < addresses.length) await new Promise((res) => setTimeout(res, 200));
  }
  return out;
}

/*
  Solana rug checks — rugcheck.xyz.

  Honeypot.is is EVM-only (it simulates a sell against a router), so Solana
  needs its own fast tier. rugcheck.xyz answers in ~1.5s with a normalised risk
  score, a list of named risks and the LP-locked share — enough to lift a fresh
  mint off the provisional cap in the same pass it's discovered, instead of
  leaving it at 30 until a full GoPlus read comes round.

  Its `score_normalised` is a RISK score: 0 is clean, 100 is dangerous. It's
  inverted here so higher always means safer, matching the EVM shape.
*/
type RcRisk = { name?: string; level?: string; score?: number };

async function rugcheckOne(mint: string): Promise<RugCheck | null> {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(9_000),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as
      | { score?: number; score_normalised?: number; risks?: RcRisk[]; lpLockedPct?: number }
      | null;
    if (!j) return null;

    const risks = Array.isArray(j.risks) ? j.risks : [];
    const named = (re: RegExp) =>
      risks.some((x) => re.test(String(x?.name ?? "")) && String(x?.level ?? "") === "danger");

    /*
      On Solana the un-sellable failure modes are a live freeze authority or a
      transfer hook that can veto a sell — the equivalent of a honeypot.
    */
    const isHoneypot = named(/freeze|non[- ]?transferable|honeypot/i);

    const riskRaw = Number(j.score_normalised);
    const riskLevel = Number.isFinite(riskRaw) ? Math.max(0, 100 - riskRaw) : 50;

    return {
      address: mint,
      simulated: true, // rugcheck inspects the mint itself, not a guess
      isHoneypot,
      buyTaxPct: 0, // SPL transfer fees surface in the full GoPlus read
      sellTaxPct: 0,
      riskLevel,
      lpLockedPct: Number.isFinite(Number(j.lpLockedPct)) ? Number(j.lpLockedPct) : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchSolanaRugChecks(mints: string[]): Promise<Map<string, RugCheck>> {
  const out = new Map<string, RugCheck>();
  if (mints.length === 0) return out;
  const CONCURRENCY = 4;
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    const wave = mints.slice(i, i + CONCURRENCY);
    const res = await Promise.all(wave.map((m) => rugcheckOne(m)));
    wave.forEach((m, idx) => {
      const r = res[idx];
      if (r) out.set(m, r);
    });
    if (i + CONCURRENCY < mints.length) await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
