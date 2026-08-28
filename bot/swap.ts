import { formatUnits, parseUnits, type Account, type Hex, type Address } from "viem";
import {
  publicClient,
  quoteBuy,
  quoteSell,
  applySlippage,
  buildBuyTx,
  buildSellTx,
  buildApproveFor,
  buildFeeTx,
  feeOf,
  tokenMeta,
  allowanceOf,
  DEX_CONFIG,
} from "@/lib/dex";
import { getMonetization } from "@/lib/config";
import { walletClientFor } from "./wallet";
import type { ChainId, EvmChainId } from "@/lib/chains";

/*
  Custodial swap execution. The bot signs and submits on the user's behalf:
   · ETH / BSC → the swap aggregator (all DEX versions), platform fee routed by
     the aggregator into the native leg.
   · Robinhood → the verified V2 router, with a separate native fee transfer.
  Approvals are handled automatically on sells. Everything is bounded and
  returns a clean result — the bot never leaves a half-broken state.
*/
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const AGG_BASE = "https://api.0x.org/swap/allowance-holder";
const AGG_CHAIN: Partial<Record<ChainId, number>> = { eth: 1, bsc: 56, base: 8453 };

export type SwapResult =
  | { ok: true; txHash: string; amountToken: number; amountNative: number }
  | { ok: false; error: string };

type ZeroExQuote = {
  transaction?: { to: string; data: string; value?: string; gas?: string };
  buyAmount?: string;
  issues?: { allowance?: { spender: string } | null; balance?: unknown };
  liquidityAvailable?: boolean;
};

async function zeroEx(
  chain: EvmChainId,
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  taker: string,
  slippageBps: number,
): Promise<ZeroExQuote | null> {
  const chainId = AGG_CHAIN[chain];
  const key = process.env.ZEROX_API_KEY;
  if (!chainId || !key) return null;
  const mon = await getMonetization();
  const feeOn = /^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet) && mon.swapFeeBps > 0;
  const q = new URLSearchParams({ chainId: String(chainId), sellToken, buyToken, sellAmount, taker, slippageBps: String(slippageBps) });
  if (feeOn) {
    q.set("swapFeeRecipient", mon.feeWallet);
    q.set("swapFeeBps", String(mon.swapFeeBps));
    q.set("swapFeeToken", sellToken.toLowerCase() === NATIVE.toLowerCase() ? sellToken : buyToken);
  }
  try {
    const r = await fetch(`${AGG_BASE}/quote?${q.toString()}`, {
      headers: { "0x-api-key": key, "0x-version": "v2" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as ZeroExQuote;
  } catch {
    return null;
  }
}

async function send(
  chain: EvmChainId,
  account: Account,
  tx: { to: string; data?: string; value?: bigint | string },
): Promise<Hex> {
  const client = walletClientFor(account, chain);
  const value =
    typeof tx.value === "bigint" ? tx.value : tx.value ? BigInt(tx.value) : 0n;
  return client.sendTransaction({
    to: tx.to as Address,
    data: (tx.data ?? "0x") as Hex,
    value,
  });
}

const slipPct = (bps: number) => bps / 100;

/* BUY: native → token for `amountNativeWei`. */
export async function executeBuy(
  account: Account,
  chain: EvmChainId,
  token: Address,
  amountNativeWei: bigint,
  slippageBps: number,
  decimals: number,
): Promise<SwapResult> {
  const owner = account.address as Address;
  const pub = publicClient(chain);
  const bal = await pub.getBalance({ address: owner });
  if (bal <= amountNativeWei) return { ok: false, error: "Not enough balance for the trade + gas." };

  // ETH / BSC → aggregator
  if (AGG_CHAIN[chain]) {
    const quote = await zeroEx(chain, NATIVE, token, amountNativeWei.toString(), owner, slippageBps);
    if (quote?.liquidityAvailable !== false && quote?.transaction?.to) {
      try {
        const hash = await send(chain, account, quote.transaction);
        await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        const out = quote.buyAmount ? Number(formatUnits(BigInt(quote.buyAmount), decimals)) : 0;
        return { ok: true, txHash: hash, amountToken: out, amountNative: Number(formatUnits(amountNativeWei, 18)) };
      } catch (e) {
        return { ok: false, error: cleanErr(e) };
      }
    }
    // fall through to V2 if the aggregator has no route
  }

  // Robinhood (and aggregator fallback) → V2 router + separate fee
  try {
    const mon = await getMonetization();
    const feeWei = /^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet) ? feeOf(amountNativeWei, mon.swapFeeBps) : 0n;
    const spend = amountNativeWei - feeWei;
    const expected = await quoteBuy(chain, token, spend);
    const minOut = applySlippage(expected, slipPct(slippageBps));
    const buyTx = buildBuyTx(chain, token, owner, spend, minOut);
    const hash = await send(chain, account, buyTx);
    await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (feeWei > 0n) {
      await send(chain, account, buildFeeTx(mon.feeWallet as Address, feeWei)).catch(() => {});
    }
    return {
      ok: true,
      txHash: hash,
      amountToken: Number(formatUnits(expected, decimals)),
      amountNative: Number(formatUnits(amountNativeWei, 18)),
    };
  } catch (e) {
    return { ok: false, error: cleanErr(e) };
  }
}

/* SELL: `amountTokenWei` of token → native. */
export async function executeSell(
  account: Account,
  chain: EvmChainId,
  token: Address,
  amountTokenWei: bigint,
  slippageBps: number,
  decimals: number,
): Promise<SwapResult> {
  const owner = account.address as Address;
  const pub = publicClient(chain);

  if (AGG_CHAIN[chain]) {
    const quote = await zeroEx(chain, token, NATIVE, amountTokenWei.toString(), owner, slippageBps);
    if (quote?.liquidityAvailable !== false && quote?.transaction?.to) {
      try {
        const spender = quote.issues?.allowance?.spender;
        if (spender) {
          const current = await pub
            .readContract({
              address: token,
              abi: [{ name: "allowance", type: "function", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }],
              functionName: "allowance",
              args: [owner, spender as Address],
            })
            .catch(() => 0n);
          if ((current as bigint) < amountTokenWei) {
            const approveHash = await send(chain, account, buildApproveFor(token, spender as Address));
            await pub.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
          }
        }
        const hash = await send(chain, account, quote.transaction);
        await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
        const nativeOut = quote.buyAmount ? Number(formatUnits(BigInt(quote.buyAmount), 18)) : 0;
        return { ok: true, txHash: hash, amountToken: Number(formatUnits(amountTokenWei, decimals)), amountNative: nativeOut };
      } catch (e) {
        return { ok: false, error: cleanErr(e) };
      }
    }
  }

  // Robinhood / fallback → V2
  try {
    const router = DEX_CONFIG[chain].router;
    const current = await allowanceOf(chain, token, owner);
    if (current < amountTokenWei) {
      const approveHash = await send(chain, account, buildApproveFor(token, router));
      await pub.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
    }
    const expected = await quoteSell(chain, token, amountTokenWei);
    const minOut = applySlippage(expected, slipPct(slippageBps));
    const sellTx = buildSellTx(chain, token, owner, amountTokenWei, minOut);
    const hash = await send(chain, account, sellTx);
    await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    // fee on the native received
    const mon = await getMonetization();
    if (/^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet)) {
      const feeWei = feeOf(expected, mon.swapFeeBps);
      if (feeWei > 0n) await send(chain, account, buildFeeTx(mon.feeWallet as Address, feeWei)).catch(() => {});
    }
    return { ok: true, txHash: hash, amountToken: Number(formatUnits(amountTokenWei, decimals)), amountNative: Number(formatUnits(expected, 18)) };
  } catch (e) {
    return { ok: false, error: cleanErr(e) };
  }
}

/* Held token balance as a float + raw wei, for the sell flow. */
export async function heldBalance(chain: EvmChainId, token: Address, owner: Address) {
  const meta = await tokenMeta(chain, token, owner);
  return { raw: meta.balance, decimals: meta.decimals, amount: Number(formatUnits(meta.balance, meta.decimals)) };
}

export function toWei(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const s = amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: decimals });
  return parseUnits(s, decimals);
}

function cleanErr(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/insufficient funds/i.test(m)) return "Not enough balance for the trade + gas.";
  if (/rejected|denied/i.test(m)) return "Transaction rejected.";
  if (/slippage|INSUFFICIENT_OUTPUT/i.test(m)) return "Price moved too much — raise slippage and retry.";
  return m.slice(0, 120);
}
