import { parseEther, parseUnits, formatUnits, type Address, type Hex } from "viem";
import { publicClient, ERC20_ABI, buildApproveFor, buildFeeTx } from "./dex";
import type { ChainId, EvmChainId } from "./chains";

/*
  One-click fee payment.

  The user shouldn't have to hold the native token to pay a fee. This finds a
  holding whose LIVE SELL QUOTE covers the fee, swaps just enough of it to
  native through the aggregator, and forwards the fee — so the operator is
  always credited in ETH/BNB while the user pays with whatever they hold.

  Pricing uses the actual swap quote, never a nominal market price, so a token
  with a manipulated price simply won't quote high enough to pay.
*/
export type Holding = {
  address: string;
  symbol: string;
  decimals: number;
  balanceRaw: string;
  balance: number;
  priceUsd: number;
  valueNative: number;
};

export type PayPlan =
  | { kind: "native"; feeWei: bigint }
  | {
      kind: "swap";
      token: Holding;
      sellRaw: bigint;
      expectedNativeWei: bigint;
      feeWei: bigint;
      quote: { to: string; data: string; value?: string };
      allowanceSpender?: string;
      /* least the desk will accept — the swap only has to clear this */
      minFeeWei: bigint;
      /* worst-case swap output; a batched payment must be sized against this */
      guaranteedNativeWei: bigint;
      /* how much worse the real fill is than the nominal price (0 = perfect) */
      impact: number;
    }
  | { kind: "none"; shortfall: string };

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/* swap a little extra so gas + slippage can't leave the fee short */
const BUFFER = 1.18;

/*
  How much worse than the nominal price a fill is allowed to be. Deliberately
  permissive: the desk would rather let a holder spend a thin token than refuse
  the payment. What keeps this safe is not this number but the guaranteed-floor
  check below — a swap only runs if its worst case still covers the fee.
*/
const MAX_IMPACT = 0.9;

type AggQuote = {
  supported: boolean;
  ok?: boolean;
  buyAmount?: string;
  /* worst-case output after slippage — what the swap actually guarantees */
  minBuyAmount?: string;
  transaction?: { to: string; data: string; value?: string } | null;
  allowance?: { spender: string } | null;
};

async function quoteSellToNative(
  chain: ChainId,
  token: string,
  sellRaw: bigint,
  taker: string,
  slippageBps = 300,
): Promise<AggQuote | null> {
  try {
    const q = new URLSearchParams({
      mode: "quote",
      sellToken: token,
      buyToken: NATIVE,
      sellAmount: sellRaw.toString(),
      taker,
      slippageBps: String(slippageBps),
    });
    const r = await fetch(`/api/swap/${chain}?${q.toString()}`, { cache: "no-store" });
    return (await r.json()) as AggQuote;
  } catch {
    return null;
  }
}

/*
  Decide how the fee gets paid. Native balance wins when it's enough (cheapest,
  one transaction); otherwise the largest holding that can actually be sold for
  the fee is used.
*/
export async function planFeePayment(opts: {
  chain: ChainId;
  owner: Address;
  feeNative: number;
  nativeBalance: number;
  holdings: Holding[];
  /* how far under the fee a payment may land, in percent */
  tolerancePct?: number;
}): Promise<PayPlan> {
  const { chain, owner, feeNative, nativeBalance, holdings } = opts;
  const feeWei = parseEther(String(feeNative));
  const tol = Math.max(0, Math.min(50, opts.tolerancePct ?? 0));
  const minFeeWei = tol > 0 ? (feeWei * BigInt(Math.round((100 - tol) * 100))) / 10000n : feeWei;

  // enough native already (keep a little aside for gas)
  if (nativeBalance >= feeNative * 1.02) return { kind: "native", feeWei };

  // try holdings, richest first
  for (const h of holdings.slice(0, 6)) {
    if (h.valueNative <= 0) continue;
    const maxRaw = BigInt(h.balanceRaw);
    const toRaw = (amount: number) => {
      try {
        const s = amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: h.decimals });
        const raw = parseUnits(s, h.decimals);
        return raw > maxRaw ? maxRaw : raw;
      } catch {
        return 0n;
      }
    };

    // first pass: size from the nominal price, only slightly over
    let sellRaw = toRaw(h.balance * Math.min(1, (feeNative * 1.05) / h.valueNative));
    if (sellRaw <= 0n) continue;
    let q = await quoteSellToNative(chain as EvmChainId, h.address, sellRaw, owner);
    if (!q?.supported || !q.ok || !q.transaction?.to || !q.buyAmount) continue;
    let out = BigInt(q.buyAmount);

    /*
      Second pass: re-size from the REAL rate this pool gives. The first quote
      tells us what the token actually fetches (nominal price ignores depth),
      so this sells close to the true amount needed instead of over-selling.
    */
    const needWei = (feeWei * BigInt(Math.round(BUFFER * 100))) / 100n;
    if (out > 0n && (out < needWei || out > (needWei * 150n) / 100n)) {
      const resized = (sellRaw * needWei) / out;
      const capped = resized > maxRaw ? maxRaw : resized;
      if (capped > 0n && capped !== sellRaw) {
        const q2 = await quoteSellToNative(chain as EvmChainId, h.address, capped, owner);
        if (q2?.ok && q2.transaction?.to && q2.buyAmount) {
          sellRaw = capped;
          q = q2;
          out = BigInt(q2.buyAmount);
        }
      }
    }

    // must genuinely cover the fee — this is what stops a token with an
    // inflated headline price from paying with worthless supply
    if (out < minFeeWei) continue;

    /*
      The expected fill is not a promise. A swap only guarantees minBuyAmount,
      and if that lands under the fee the swap still executes — spending the
      holding and leaving the fee unpayable. So the FLOOR has to cover the fee,
      not the estimate.

      When the estimate covers it but the floor doesn't, the gap is slippage
      tolerance rather than depth, so re-quote tighter before giving up.
    */
    let floor = q.minBuyAmount ? BigInt(q.minBuyAmount) : out;
    if (floor < minFeeWei) {
      for (const bps of [150, 75]) {
        const tight = await quoteSellToNative(chain as EvmChainId, h.address, sellRaw, owner, bps);
        if (!tight?.ok || !tight.transaction?.to || !tight.buyAmount) continue;
        const tightFloor = tight.minBuyAmount ? BigInt(tight.minBuyAmount) : BigInt(tight.buyAmount);
        if (tightFloor >= minFeeWei) {
          q = tight;
          out = BigInt(tight.buyAmount);
          floor = tightFloor;
          break;
        }
      }
    }
    if (floor < minFeeWei) continue;

    /*
      Fair-rate guard: compare what the pool really pays against the nominal
      value of the same amount. A huge gap means the pool is too thin to sell
      into — bad for the payer and for us, so we skip that token.
    */
    const soldFraction = Number(formatUnits(sellRaw, h.decimals)) / Math.max(h.balance, 1e-18);
    const nominalNative = h.valueNative * soldFraction;
    const realNative = Number(formatUnits(out, 18));
    const impact = nominalNative > 0 ? 1 - realNative / nominalNative : 1;
    if (impact > MAX_IMPACT) continue;

    // re-narrow: `q` may have been replaced by the second-pass quote
    const tx = q.transaction;
    if (!tx?.to) continue;

    return {
      kind: "swap",
      token: h,
      sellRaw,
      expectedNativeWei: out,
      feeWei,
      quote: tx,
      allowanceSpender: q.allowance?.spender ?? undefined,
      minFeeWei,
      guaranteedNativeWei: floor,
      impact,
    };
  }

  return { kind: "none", shortfall: "Not enough balance to cover the fee." };
}

type Send = (tx: { to: string; data?: string; value?: string }) => Promise<Hex>;

/*
  Batched send (EIP-5792 wallet_sendCalls). Wallets that support it show ONE
  confirmation for the whole sequence — approve, swap, pay — and execute it
  atomically, so a payer can't end up having sold the token without the fee
  landing. Wallets that don't support it fall back to signing each step.
*/
export type SendBatch = (
  calls: { to: string; data?: string; value?: string }[],
) => Promise<Hex | null>;

/*
  What the fee call can safely carry inside a batch. The post-swap balance can't
  be read mid-batch, so the amount is fixed up front against the swap's
  guaranteed floor — never the estimate, or a weak fill would make the whole
  batch revert.
*/
export function batchFeeWei(plan: PayPlan, nativeBalanceWei: bigint): bigint {
  if (plan.kind !== "swap") return plan.kind === "native" ? plan.feeWei : 0n;
  const GAS_RESERVE = 300_000_000_000_000n; // 0.0003 native
  const worstCase = nativeBalanceWei + plan.guaranteedNativeWei;
  const spendable = worstCase > GAS_RESERVE ? worstCase - GAS_RESERVE : 0n;
  return spendable < plan.feeWei ? spendable : plan.feeWei;
}

/*
  Run the plan. Signing is silent for the account wallet, so this is a single
  user action: approve (only if needed) → swap → forward the fee.
  Returns the fee transaction hash, which the server verifies on-chain.
*/
export async function executeFeePayment(opts: {
  chain: ChainId;
  owner: Address;
  feeWallet: Address;
  plan: PayPlan;
  send: Send;
  sendBatch?: SendBatch;
  onStep?: (label: string) => void;
}): Promise<string> {
  const { chain, owner, feeWallet, plan, send, sendBatch, onStep } = opts;
  const client = publicClient(chain as EvmChainId);

  if (plan.kind === "none") throw new Error(plan.shortfall);

  /*
    One confirmation for everything, where the wallet can do it. Returning null
    means the wallet declined the batch (unsupported), so we drop through to the
    step-by-step path below rather than failing the payment.
  */
  if (sendBatch && plan.kind === "swap") {
    const nativeBefore = await client.getBalance({ address: owner }).catch(() => 0n);
    const payWei = batchFeeWei(plan, nativeBefore);
    if (payWei >= plan.minFeeWei) {
      const calls: { to: string; data?: string; value?: string }[] = [];
      if (plan.allowanceSpender) {
        const current = (await client
          .readContract({
            address: plan.token.address as Address,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [owner, plan.allowanceSpender as Address],
          })
          .catch(() => 0n)) as bigint;
        if (current < plan.sellRaw) {
          calls.push(buildApproveFor(plan.token.address as Address, plan.allowanceSpender as Address));
        }
      }
      calls.push(plan.quote);
      calls.push(buildFeeTx(feeWallet, payWei));

      onStep?.("Processing…");
      const hash = await sendBatch(calls).catch(() => null);
      if (hash) return hash;
    }
  }

  if (plan.kind === "swap") {
    // approve the aggregator only when the existing allowance is short
    if (plan.allowanceSpender) {
      const current = (await client
        .readContract({
          address: plan.token.address as Address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, plan.allowanceSpender as Address],
        })
        .catch(() => 0n)) as bigint;
      if (current < plan.sellRaw) {
        onStep?.("Preparing payment…");
        const approveHash = await send(buildApproveFor(plan.token.address as Address, plan.allowanceSpender as Address));
        await client.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
      }
    }
    onStep?.("Processing…");
    const swapHash = await send(plan.quote);
    await client.waitForTransactionReceipt({ hash: swapHash, timeout: 150_000 });
  }

  onStep?.("Paying the fee…");
  /*
    Pay from what the swap actually produced. The quote was an estimate; the
    fill is the truth. Sending a hard-coded amount larger than the balance just
    fails, which would burn the swap and credit nobody — so send the fee when
    it's there, and the remaining balance (less gas) when the fill came up
    slightly short. The server accepts anything above its tolerance.
  */
  let payWei = plan.feeWei;
  if (plan.kind === "swap") {
    const balance = await client.getBalance({ address: owner }).catch(() => 0n);
    const GAS_RESERVE = 300_000_000_000_000n; // 0.0003 native, ample on an L2
    const spendable = balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n;
    if (spendable < plan.feeWei) {
      if (spendable < plan.minFeeWei) {
        throw new Error("The swap came up short of the fee. Nothing was charged — try again.");
      }
      payWei = spendable;
    }
  }
  const feeHash = await send(buildFeeTx(feeWallet, payWei));
  await client.waitForTransactionReceipt({ hash: feeHash, timeout: 150_000 });
  return feeHash;
}

/* Human summary of what will be charged, for the button label. */
export function describePlan(plan: PayPlan, feeNative: number, nativeSymbol: string): string {
  if (plan.kind === "native") return `${feeNative} ${nativeSymbol}`;
  if (plan.kind === "swap") {
    const amt = Number(formatUnits(plan.sellRaw, plan.token.decimals));
    const short = amt >= 1 ? amt.toLocaleString(undefined, { maximumFractionDigits: 2 }) : amt.toPrecision(3);
    return `${short} ${plan.token.symbol}`;
  }
  return "—";
}
