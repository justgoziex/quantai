import { publicClient } from "@/lib/dex";
import { getMonetization } from "@/lib/config";
import { verifySolFeePayment } from "@/lib/solana";
import type { ChainId, EvmChainId } from "@/lib/chains";

/*
  Shared on-chain fee verification for paid features (dev listings, ad slots).
  A payment is valid when the tx is confirmed, succeeded, was sent to the
  platform fee wallet, and carries at least the expected native amount.
*/
export type FeeCheck =
  | { ok: true; from: string; paidEth: number }
  | { ok: false; pending?: boolean; error: string };

/* Never let a slow RPC hang the request past the function's time limit. */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(onTimeout), ms))]);
}

export async function verifyFeePayment(
  chain: ChainId,
  txHash: string,
  expectedEth: number,
): Promise<FeeCheck> {
  /*
    Solana settles differently — no tx.to, no tx.value — so it verifies through
    the fee wallet's balance delta instead. Same contract to the caller.
  */
  if (chain === "sol") {
    const mon = await getMonetization();
    return withTimeout(
      verifySolFeePayment(txHash, expectedEth, mon.feeWalletSol, mon.feeTolerancePct ?? 0).then(
        (r): FeeCheck =>
          r.ok
            ? { ok: true, from: r.from ?? "", paidEth: r.paidSol ?? 0 }
            : { ok: false, pending: r.pending, error: r.error ?? "That payment couldn't be verified." },
      ),
      25_000,
      { ok: false, pending: true, error: "The network is slow to confirm — your payment is fine, try again in a moment." },
    );
  }
  return withTimeout(verify(chain as EvmChainId, txHash, expectedEth), 25_000, {
    ok: false,
    pending: true,
    error: "The network is slow to confirm — your payment is fine, try again in a moment.",
  });
}

async function verify(chain: EvmChainId, txHash: string, expectedEth: number): Promise<FeeCheck> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, error: "That transaction hash isn't valid." };
  const mon = await getMonetization();
  if (!/^0x[0-9a-fA-F]{40}$/.test(mon.feeWallet)) {
    return { ok: false, error: "Payments aren't configured yet — contact the desk." };
  }
  try {
    const client = publicClient(chain);
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
    if (!receipt) {
      const tx = await client.getTransaction({ hash: txHash as `0x${string}` }).catch(() => null);
      if (tx) return { ok: false, pending: true, error: "Payment is still confirming — try again in a moment." };
      return { ok: false, error: "That transaction wasn't found on this chain." };
    }
    if (receipt.status !== "success") return { ok: false, error: "That payment failed on-chain." };
    const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
    if ((tx.to ?? "").toLowerCase() !== mon.feeWallet.toLowerCase()) {
      return { ok: false, error: "Payment wasn't sent to the Quant AI payment address." };
    }
    /*
      Accept a payment that lands slightly under the quoted fee. Fees paid by
      swapping a token arrive at whatever the pool gave, and rejecting a fill
      that is a fraction short would take the payer's token and give nothing
      back. The tolerance is the desk's, set in monetization config.
    */
    const paidEth = Number(tx.value) / 1e18;
    const floorEth = expectedEth * (1 - Math.max(0, Math.min(50, mon.feeTolerancePct ?? 0)) / 100);
    if (paidEth + 1e-9 < floorEth) {
      return { ok: false, error: `The fee is ${expectedEth} — that payment was ${paidEth.toFixed(5)}.` };
    }
    return { ok: true, from: tx.from.toLowerCase(), paidEth };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 120) };
  }
}
