/*
  Chain registry — single source of truth for supported networks.
  Quant AI screens Ethereum, BNB Smart Chain, Base, and Robinhood Chain, and
  launches/trades on the EVM mainnets. `securitySupported` gates GoPlus
  enrichment; `tradable`/`launchable` gate the swap + launcher surfaces.
*/
export type ChainId = "eth" | "bsc" | "base" | "rh" | "sol";

/*
  The EVM subset. Router configs, ABIs and approvals are meaningless on Solana,
  so anything EVM-only is keyed to this instead of ChainId — the compiler then
  points at every place that needs a Solana branch.
*/
export type EvmChainId = Exclude<ChainId, "sol">;
export const isEvm = (c: ChainId): c is EvmChainId => c !== "sol";
export const isSvm = (c: ChainId): boolean => c === "sol";

/*
  Which virtual machine a chain runs. Everything that touches addresses, ABIs,
  approvals or signing branches on this — EVM chains share one execution path,
  Solana has its own.
*/
export type Vm = "evm" | "svm";

export type Chain = {
  id: ChainId;
  vm: Vm;
  name: string;
  shortName: string;
  gas: string; // native gas token symbol
  wrapped: string; // wrapped native used in pairs
  dex: string; // primary DEX screened
  explorer: string; // explorer host, "" when unknown
  deployFee: string; // launcher fee display
  securitySupported: boolean; // GoPlus coverage
  tradable: boolean; // swap execution available
  launchable: boolean; // token launcher available
  /*
    Share of ingest passes this chain earns. Solana mints far more new pairs
    per hour than any EVM chain here, so an even rotation would leave most of
    them unseen — it takes a double share.
  */
  ingestWeight: number;
};

export const CHAINS: Record<ChainId, Chain> = {
  eth: {
    id: "eth",
    vm: "evm",
    name: "Ethereum",
    shortName: "ETH",
    gas: "ETH",
    wrapped: "WETH",
    dex: "Uniswap v2/v3",
    explorer: "etherscan.io",
    deployFee: "0.025 ETH",
    securitySupported: true,
    tradable: true,
    launchable: true,
    ingestWeight: 1,
  },
  bsc: {
    id: "bsc",
    vm: "evm",
    name: "BNB Smart Chain",
    shortName: "BSC",
    gas: "BNB",
    wrapped: "WBNB",
    dex: "PancakeSwap v2/v3",
    explorer: "bscscan.com",
    deployFee: "0.12 BNB",
    securitySupported: true,
    tradable: true,
    launchable: true,
    ingestWeight: 1,
  },
  base: {
    id: "base",
    vm: "evm",
    name: "Base",
    shortName: "BASE",
    gas: "ETH",
    wrapped: "WETH",
    dex: "Uniswap v2/v3 · Aerodrome",
    explorer: "basescan.org",
    deployFee: "0.005 ETH",
    securitySupported: true,
    tradable: true,
    launchable: false,
    ingestWeight: 1,
  },
  sol: {
    id: "sol",
    vm: "svm",
    name: "Solana",
    shortName: "SOL",
    gas: "SOL",
    wrapped: "SOL", // wrapped SOL is the pair side, but users think in SOL
    dex: "Raydium · Orca · pump.fun",
    explorer: "solscan.io",
    deployFee: "—",
    securitySupported: true, // GoPlus has a Solana endpoint
    tradable: true, // routed through Jupiter
    launchable: true, // SPL mint + Metaplex metadata, signed by the developer
    ingestWeight: 2,
  },
  rh: {
    id: "rh",
    vm: "evm",
    name: "Robinhood Chain",
    shortName: "RH",
    gas: "ETH",
    wrapped: "WETH",
    dex: "Uniswap v2/v3",
    explorer: "robinhoodchain.blockscout.com",
    deployFee: "—",
    securitySupported: false, // no GoPlus coverage yet — market-only scoring
    tradable: true, // Uniswap V2 router verified on-chain
    launchable: false,
    ingestWeight: 1,
  },
};

export const CHAIN_LIST = Object.values(CHAINS);

/* Chains offered in the launcher / trade surfaces. */
export const LAUNCHABLE_CHAINS = CHAIN_LIST.filter((c) => c.launchable);
export const TRADABLE_CHAINS = CHAIN_LIST.filter((c) => c.tradable);

/*
  Case handling differs by VM. EVM addresses are hex and case-insensitive, so
  the codebase lowercases them everywhere to make comparisons trivial. Solana
  addresses are base58 and CASE-SENSITIVE — lowercasing one produces a
  different, invalid address. Every stored or compared address goes through
  this.
*/
export function normalizeAddress(chain: ChainId, address: string): string {
  const a = String(address ?? "").trim();
  return chain === "sol" ? a : a.toLowerCase();
}
