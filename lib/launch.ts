import type { ChainId, EvmChainId } from "./chains";

/*
  Token launcher domain logic.
  The launch score preview runs the SAME gate ideas the screener uses, so a
  creator sees exactly how their configuration will read to traders — before
  spending gas. Weights here are the documented launch-config subset; the
  full screener adds live-market gates (momentum, holders, depth) after listing.
*/
export type LaunchConfig = {
  chain: EvmChainId;
  name: string;
  symbol: string;
  totalSupply: string; // human units
  buyTaxPct: number;
  sellTaxPct: number;
  maxWalletPct: number; // 0 = no limit
  initialLiquidity: string; // in gas token
  lpLockDays: 0 | 30 | 90 | 180 | 365;
  renounceOwnership: boolean;
  revokeMint: boolean;
};

export const DEFAULT_CONFIG: LaunchConfig = {
  chain: "eth",
  name: "",
  symbol: "",
  totalSupply: "1000000000",
  buyTaxPct: 0,
  sellTaxPct: 0,
  maxWalletPct: 2,
  initialLiquidity: "",
  lpLockDays: 180,
  renounceOwnership: true,
  revokeMint: true,
};

export type GateReading = {
  gate: string;
  points: number;
  max: number;
  verdict: "pass" | "warn" | "fail";
  note: string;
};

/* Launch-config gates: 100 points total across 6 configurable checks. */
export function scoreLaunchConfig(c: LaunchConfig): {
  score: number;
  readings: GateReading[];
} {
  const readings: GateReading[] = [];

  // Contract verification — the launcher always publishes verified source.
  readings.push({
    gate: "Contract verification",
    points: 10,
    max: 10,
    verdict: "pass",
    note: "Source auto-verified on deploy",
  });

  // Honeypot — launcher templates are sell-tested; taxes above 25% would trip it.
  const honeypot = c.sellTaxPct <= 25;
  readings.push({
    gate: "Honeypot simulation",
    points: honeypot ? 15 : 0,
    max: 15,
    verdict: honeypot ? "pass" : "fail",
    note: honeypot ? "Sell path simulated clean" : "Sell tax this high reads as a trap",
  });

  // LP lock
  const lp =
    c.lpLockDays >= 365 ? 25 : c.lpLockDays >= 180 ? 22 : c.lpLockDays >= 90 ? 15 : c.lpLockDays >= 30 ? 8 : 0;
  readings.push({
    gate: "LP lock",
    points: lp,
    max: 25,
    verdict: c.lpLockDays >= 180 ? "pass" : c.lpLockDays >= 30 ? "warn" : "fail",
    note:
      c.lpLockDays > 0
        ? `Locked ${c.lpLockDays} days`
        : "Unlocked LP is the #1 rug vector",
  });

  // Mint authority
  readings.push({
    gate: "Mint authority",
    points: c.revokeMint ? 15 : 0,
    max: 15,
    verdict: c.revokeMint ? "pass" : "fail",
    note: c.revokeMint ? "Revoked at deploy" : "Open mint caps every score",
  });

  // Ownership
  readings.push({
    gate: "Ownership",
    points: c.renounceOwnership ? 15 : 6,
    max: 15,
    verdict: c.renounceOwnership ? "pass" : "warn",
    note: c.renounceOwnership
      ? "Renounced — no privileged calls"
      : "Owner keeps privileged functions",
  });

  // Taxes
  const worstTax = Math.max(c.buyTaxPct, c.sellTaxPct);
  const taxPts = worstTax === 0 ? 20 : worstTax <= 3 ? 16 : worstTax <= 5 ? 12 : worstTax <= 10 ? 6 : 0;
  readings.push({
    gate: "Buy/sell tax",
    points: taxPts,
    max: 20,
    verdict: worstTax <= 5 ? "pass" : worstTax <= 10 ? "warn" : "fail",
    note: worstTax === 0 ? "Tax-free" : `Effective worst-case ${worstTax}%`,
  });

  const score = readings.reduce((s, r) => s + r.points, 0);
  return { score, readings };
}

export function validateBasics(c: LaunchConfig): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!c.name.trim()) errs.name = "Give the token a name.";
  else if (c.name.trim().length > 32) errs.name = "Keep the name under 32 characters.";
  if (!c.symbol.trim()) errs.symbol = "Pick a ticker symbol.";
  else if (!/^[A-Z0-9]{2,8}$/.test(c.symbol)) errs.symbol = "2–8 characters, A–Z and 0–9 only.";
  const supply = Number(c.totalSupply);
  if (!c.totalSupply || !Number.isFinite(supply) || supply <= 0)
    errs.totalSupply = "Total supply must be a positive number.";
  else if (supply > 1e15) errs.totalSupply = "Keep supply at or below 1 quadrillion.";
  return errs;
}

export function formatSupply(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}
