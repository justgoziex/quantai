import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { publicClient, DEX_CONFIG } from "./dex";
import type { ChainId, EvmChainId } from "./chains";

/*
  Uniswap V3 routing layer.

  Chains like Robinhood keep most liquidity in V3 pools, and not always against
  the native token — plenty of pairs quote in USDG. So we search every
  intermediary we know about and, when a token only pairs with a stable, route
  through two hops (native → stable → token). Quotes come from pool spot price;
  the on-chain minOut is what actually protects the fill.

  Addresses verified on-chain (pool.factory(), router.factory()/WETH9()).
*/
export const V3_CONFIG: Partial<Record<ChainId, { factory: Address; router: Address }>> = {
  rh: {
    factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
    router: "0xcaf681a66d020601342297493863e78c959e5cb2", // SwapRouter02 (verified)
  },
};

/* Quote tokens to try, beyond the wrapped native, per chain. */
const INTERMEDIARIES: Partial<Record<ChainId, Address[]>> = {
  rh: ["0x5fc5360d0400a0fd4f2af552add042d716f1d168"], // USDG
};

const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;
const ZERO = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [100, 500, 2500, 3000, 10000];

const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);
const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
]);
export const V3_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

export function v3Supported(chain: EvmChainId): boolean {
  return Boolean(V3_CONFIG[chain]);
}

type Pool = { pool: Address; fee: number; sqrtPriceX96: bigint; liquidity: bigint; token0: Address };
/* A route is 1 hop (token↔native) or 2 hops (token↔stable↔native). */
export type V3Route = { hops: { fee: number; pool: Pool }[]; path: Address[] };

const Q96 = 2n ** 96n;

async function poolState(chain: EvmChainId, pool: Address, fee: number): Promise<Pool | null> {
  try {
    const client = publicClient(chain);
    const [slot0, liquidity, token0] = await Promise.all([
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "token0" }),
    ]);
    return {
      pool,
      fee,
      sqrtPriceX96: (slot0 as unknown as bigint[])[0],
      liquidity: liquidity as bigint,
      token0: token0 as Address,
    };
  } catch {
    return null;
  }
}

/* Deepest pool between two tokens across all fee tiers. */
async function bestPool(chain: EvmChainId, a: Address, b: Address): Promise<Pool | null> {
  const cfg = V3_CONFIG[chain];
  if (!cfg) return null;
  const client = publicClient(chain);
  const addrs = await Promise.all(
    FEE_TIERS.map((fee) =>
      client
        .readContract({ address: cfg.factory, abi: FACTORY_ABI, functionName: "getPool", args: [a, b, fee] })
        .then((p) => ({ pool: p as Address, fee }))
        .catch(() => ({ pool: ZERO as Address, fee })),
    ),
  );
  const states = await Promise.all(
    addrs.filter((x) => x.pool && x.pool !== ZERO).map((x) => poolState(chain, x.pool, x.fee)),
  );
  const live = states.filter((s): s is Pool => s !== null && s.liquidity > 0n);
  live.sort((x, y) => (y.liquidity > x.liquidity ? 1 : y.liquidity < x.liquidity ? -1 : 0));
  return live[0] ?? null;
}

/*
  Find a tradeable route from the native token to `token`. Prefers the direct
  native pair; falls back to routing through a stable (e.g. USDG on Robinhood).
*/
export async function findV3Route(chain: EvmChainId, token: Address): Promise<V3Route | null> {
  if (!V3_CONFIG[chain]) return null;
  const wrapped = DEX_CONFIG[chain].wrapped;

  const direct = await bestPool(chain, wrapped, token);
  if (direct) return { hops: [{ fee: direct.fee, pool: direct }], path: [wrapped, token] };

  for (const mid of INTERMEDIARIES[chain] ?? []) {
    const [legA, legB] = await Promise.all([
      bestPool(chain, wrapped, mid), // native ↔ stable
      bestPool(chain, mid, token), // stable ↔ token
    ]);
    if (legA && legB) {
      return { hops: [{ fee: legA.fee, pool: legA }, { fee: legB.fee, pool: legB }], path: [wrapped, mid, token] };
    }
  }
  return null;
}

/* Output of one pool for a given input token, from spot price, minus its fee. */
function spotOut(pool: Pool, amountIn: bigint, tokenIn: Address): bigint {
  if (amountIn <= 0n || pool.sqrtPriceX96 <= 0n) return 0n;
  const inIsToken0 = pool.token0.toLowerCase() === tokenIn.toLowerCase();
  const num = pool.sqrtPriceX96 * pool.sqrtPriceX96;
  const out = inIsToken0 ? (amountIn * num) / (Q96 * Q96) : (amountIn * Q96 * Q96) / num;
  return (out * BigInt(1_000_000 - pool.fee)) / 1_000_000n;
}

/* Quote across the whole route. `buying` = native → token. */
export function quoteRoute(route: V3Route, amountIn: bigint, buying: boolean): bigint {
  const path = buying ? route.path : [...route.path].reverse();
  const hops = buying ? route.hops : [...route.hops].reverse();
  let amount = amountIn;
  for (let i = 0; i < hops.length; i++) {
    amount = spotOut(hops[i].pool, amount, path[i]);
    if (amount <= 0n) return 0n;
  }
  return amount;
}

/* Uniswap path encoding: token (20) | fee (3) | token (20) | … */
function encodePath(tokens: Address[], fees: number[]): Hex {
  let out = tokens[0].toLowerCase().replace("0x", "");
  for (let i = 0; i < fees.length; i++) {
    out += fees[i].toString(16).padStart(6, "0");
    out += tokens[i + 1].toLowerCase().replace("0x", "");
  }
  return `0x${out}` as Hex;
}

/* BUY: native → token (single payable call; the router wraps the ETH). */
export function buildV3BuyTx(
  chain: EvmChainId,
  recipient: Address,
  amountInWei: bigint,
  minOut: bigint,
  route: V3Route,
) {
  const cfg = V3_CONFIG[chain]!;
  const value = `0x${amountInWei.toString(16)}` as Hex;
  if (route.hops.length === 1) {
    return {
      to: cfg.router,
      value,
      data: encodeFunctionData({
        abi: V3_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: route.path[0],
            tokenOut: route.path[1],
            fee: route.hops[0].fee,
            recipient,
            amountIn: amountInWei,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    };
  }
  return {
    to: cfg.router,
    value,
    data: encodeFunctionData({
      abi: V3_ROUTER_ABI,
      functionName: "exactInput",
      args: [
        {
          path: encodePath(route.path, route.hops.map((h) => h.fee)),
          recipient,
          amountIn: amountInWei,
          amountOutMinimum: minOut,
        },
      ],
    }),
  };
}

/*
  SELL: token → native. Swap output stays in the router as WETH, then
  unwrapWETH9 forwards real ETH to the user — one multicall.
*/
export function buildV3SellTx(
  chain: EvmChainId,
  recipient: Address,
  amountIn: bigint,
  minOut: bigint,
  route: V3Route,
) {
  const cfg = V3_CONFIG[chain]!;
  const revPath = [...route.path].reverse();
  const revFees = [...route.hops].reverse().map((h) => h.fee);
  const swap =
    route.hops.length === 1
      ? encodeFunctionData({
          abi: V3_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: revPath[0],
              tokenOut: revPath[1],
              fee: revFees[0],
              recipient: ADDRESS_THIS,
              amountIn,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      : encodeFunctionData({
          abi: V3_ROUTER_ABI,
          functionName: "exactInput",
          args: [{ path: encodePath(revPath, revFees), recipient: ADDRESS_THIS, amountIn, amountOutMinimum: minOut }],
        });
  const unwrap = encodeFunctionData({
    abi: V3_ROUTER_ABI,
    functionName: "unwrapWETH9",
    args: [minOut, recipient],
  });
  return {
    to: cfg.router,
    value: "0x0" as Hex,
    data: encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "multicall", args: [[swap, unwrap]] }),
  };
}

export function v3Router(chain: EvmChainId): Address | null {
  return V3_CONFIG[chain]?.router ?? null;
}
