import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  defineChain,
  type Address,
  type Hex,
} from "viem";
import { mainnet, bsc, base } from "viem/chains";
import type { ChainId, EvmChainId } from "./chains";

/* Robinhood Chain — Arbitrum L2, chain id 4663, native ETH. */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/*
  On-chain execution layer — V2-style router swaps, no third-party APIs.
  ETH → Uniswap V2 Router 02 · BSC → PancakeSwap V2 Router.
  Fee-on-transfer-safe swap variants cover most memecoins.
*/
export const DEX_CONFIG: Record<
  EvmChainId,
  {
    chainIdNum: number;
    chainIdHex: string;
    router: Address;
    wrapped: Address;
    routerName: string;
    explorerTx: string;
  }
> = {
  eth: {
    chainIdNum: 1,
    chainIdHex: "0x1",
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router 02
    wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    routerName: "Uniswap V2",
    explorerTx: "https://etherscan.io/tx/",
  },
  bsc: {
    chainIdNum: 56,
    chainIdHex: "0x38",
    router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", // PancakeSwap V2 Router
    wrapped: "0xbb4CdB9CBd36B01bD1cBaEF60aF814a3f6F0Ee75", // WBNB
    routerName: "PancakeSwap V2",
    explorerTx: "https://bscscan.com/tx/",
  },
  base: {
    chainIdNum: 8453,
    chainIdHex: "0x2105",
    router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2 router (Base)
    wrapped: "0x4200000000000000000000000000000000000006", // WETH
    routerName: "Uniswap V2",
    explorerTx: "https://basescan.org/tx/",
  },
  // Robinhood Chain — Uniswap V2 (verified on-chain: factory + WETH match).
  rh: {
    chainIdNum: 4663,
    chainIdHex: "0x1237",
    router: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba", // Uniswap V2 Router02
    wrapped: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", // WETH
    routerName: "Uniswap V2",
    explorerTx: "https://robinhoodchain.blockscout.com/tx/",
  },
};

export const RPC: Record<ChainId, string> = {
  eth: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  rh: "https://rpc.mainnet.chain.robinhood.com",
  sol: "https://solana-rpc.publicnode.com",
};

export const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

export function publicClient(chain: EvmChainId) {
  return createPublicClient({
    chain: chain === "eth" ? mainnet : chain === "bsc" ? bsc : chain === "base" ? base : robinhoodChain,
    transport: http(RPC[chain]),
    // default is 4s, which makes every confirmation feel sluggish — BSC/Base/RH
    // produce blocks far faster than that
    pollingInterval: 600,
  });
}

/* Quote: how much token for `amountInWei` native (buy) or native for token (sell). */
export async function quoteBuy(chain: EvmChainId, token: Address, amountInWei: bigint) {
  const cfg = DEX_CONFIG[chain];
  const amounts = await publicClient(chain).readContract({
    address: cfg.router,
    abi: ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [amountInWei, [cfg.wrapped, token]],
  });
  return amounts[amounts.length - 1];
}

export async function quoteSell(chain: EvmChainId, token: Address, amountInWei: bigint) {
  const cfg = DEX_CONFIG[chain];
  const amounts = await publicClient(chain).readContract({
    address: cfg.router,
    abi: ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [amountInWei, [token, cfg.wrapped]],
  });
  return amounts[amounts.length - 1];
}

export async function tokenMeta(chain: EvmChainId, token: Address, owner: Address) {
  const client = publicClient(chain);
  const [decimals, balance] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }).catch(() => 18),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }).catch(() => 0n),
  ]);
  return { decimals: Number(decimals), balance };
}

export async function allowanceOf(chain: EvmChainId, token: Address, owner: Address) {
  return publicClient(chain).readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, DEX_CONFIG[chain].router],
  });
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
}

export function applySlippage(amount: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round(slippagePct * 100));
  return (amount * (10_000n - bps)) / 10_000n;
}

/* Transaction payloads for the wallet provider (eth_sendTransaction). */
export function buildBuyTx(
  chain: EvmChainId,
  token: Address,
  recipient: Address,
  amountInWei: bigint,
  minOut: bigint,
) {
  const cfg = DEX_CONFIG[chain];
  return {
    to: cfg.router,
    value: `0x${amountInWei.toString(16)}` as Hex,
    data: encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
      args: [minOut, [cfg.wrapped, token], recipient, deadline()],
    }),
  };
}

export function buildSellTx(
  chain: EvmChainId,
  token: Address,
  recipient: Address,
  amountIn: bigint,
  minOut: bigint,
) {
  const cfg = DEX_CONFIG[chain];
  return {
    to: cfg.router,
    value: "0x0" as Hex,
    data: encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
      args: [amountIn, minOut, [token, cfg.wrapped], recipient, deadline()],
    }),
  };
}

/* Approve an arbitrary spender (used for aggregator swaps). */
export function buildApproveFor(token: Address, spender: Address) {
  return {
    to: token,
    value: "0x0" as Hex,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, 2n ** 256n - 1n],
    }),
  };
}

export function buildApproveTx(chain: EvmChainId, token: Address) {
  return {
    to: token,
    value: "0x0" as Hex,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [DEX_CONFIG[chain].router, 2n ** 256n - 1n],
    }),
  };
}

export async function waitForTx(chain: EvmChainId, hash: Hex) {
  return publicClient(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
}

/* Plain native-value transfer — used to collect the platform swap fee. */
export function buildFeeTx(to: Address, amountWei: bigint) {
  return {
    to,
    value: `0x${amountWei.toString(16)}` as Hex,
    data: "0x" as Hex,
  };
}

/* Platform fee on a native amount, in wei. bps=100 → 1%. */
export function feeOf(amountWei: bigint, bps: number): bigint {
  if (!Number.isFinite(bps) || bps <= 0) return 0n;
  return (amountWei * BigInt(Math.round(bps))) / 10_000n;
}
