import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  jupQuote,
  jupSwapTx,
  jupImpact,
  mintDecimals,
  splBalance,
  solBalance,
  SOL_RPC,
  WSOL,
  SOL_DECIMALS,
} from "@/lib/solana";
import type { SwapResult } from "./swap";

/*
  Solana trade execution for the bot.

  Nothing here mirrors the EVM path's structure because nothing about the
  mechanics matches: there is no allowance to grant, no router address to pick,
  no gas limit to estimate. The aggregator returns one complete transaction,
  the custodial keypair signs it, and the network confirms it.

  Kept as its own module for the same reason the browser panel is: threading
  Solana through the EVM functions would mean a branch at every step, and the
  steps aren't the same steps.
*/

/* Enough SOL left behind to pay for the transaction and rent. */
const FEE_HEADROOM_SOL = 0.003;

async function sendSigned(tx64: string, keypair: Keypair): Promise<string> {
  const conn = new Connection(SOL_RPC, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(tx64, "base64"));
  tx.sign([keypair]);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const res = await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) throw new Error("The network rejected the trade.");
  return sig;
}

function readable(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/insufficient|0x1$/i.test(m)) return "Not enough balance for the trade.";
  if (/blockhash|expired/i.test(m)) return "That took too long to confirm — try again.";
  if (/slippage|0x1771/i.test(m)) return "Price moved past your slippage — try again.";
  return "That trade didn't go through.";
}

/* Buy a token with SOL. `amountSol` is a human amount, not lamports. */
export async function executeSolBuy(
  keypair: Keypair,
  mint: string,
  amountSol: number,
  slippageBps: number,
): Promise<SwapResult> {
  const owner = keypair.publicKey.toBase58();
  try {
    const bal = await solBalance(owner);
    if (bal < amountSol + FEE_HEADROOM_SOL) {
      return { ok: false, error: "Not enough balance to cover the trade." };
    }

    const quote = await jupQuote({
      inputMint: WSOL,
      outputMint: mint,
      amountRaw: BigInt(Math.floor(amountSol * 10 ** SOL_DECIMALS)),
      slippageBps,
    });
    if (!quote) return { ok: false, error: "No route for that size." };

    // the same ceiling the site applies — a thin pool is the trade's real risk
    const impact = jupImpact(quote) * 100;
    if (impact > 20) {
      return { ok: false, error: `That size moves the price ${impact.toFixed(1)}%. Try smaller.` };
    }

    const tx = await jupSwapTx({ quote, userPublicKey: owner });
    if (!tx) return { ok: false, error: "Couldn't build that trade." };

    const sig = await sendSigned(tx, keypair);
    const dec = await mintDecimals(mint);
    return {
      ok: true,
      txHash: sig,
      amountToken: Number(quote.outAmount) / 10 ** dec,
      amountNative: amountSol,
    };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}

/* Sell a percentage of the held balance back to SOL. */
export async function executeSolSell(
  keypair: Keypair,
  mint: string,
  pct: number,
  slippageBps: number,
): Promise<SwapResult> {
  const owner = keypair.publicKey.toBase58();
  try {
    const held = await splBalance(owner, mint);
    if (held.amount <= 0n) return { ok: false, error: "You don't hold this token." };

    /*
      Size the sell from the raw on-chain amount, not the display figure. A
      100% sell has to spend exactly what's held — going through the float
      leaves dust behind or asks for more than exists, and both fail.
    */
    const share = BigInt(Math.min(100, Math.max(1, Math.round(pct))));
    const raw = (held.amount * share) / 100n;
    if (raw <= 0n) return { ok: false, error: "That amount is too small to trade." };
    const amount = Number(raw) / 10 ** held.decimals;

    const quote = await jupQuote({
      inputMint: mint,
      outputMint: WSOL,
      amountRaw: raw,
      slippageBps,
    });
    if (!quote) return { ok: false, error: "No route for that size." };

    const tx = await jupSwapTx({ quote, userPublicKey: owner });
    if (!tx) return { ok: false, error: "Couldn't build that trade." };

    const sig = await sendSigned(tx, keypair);
    return {
      ok: true,
      txHash: sig,
      amountToken: amount,
      amountNative: Number(quote.outAmount) / 10 ** SOL_DECIMALS,
    };
  } catch (e) {
    return { ok: false, error: readable(e) };
  }
}

/* Held balance of one mint, for position sizing and the holdings view. */
export async function solHeldBalance(owner: string, mint: string): Promise<number> {
  return splBalance(owner, mint)
    .then((b) => b.ui)
    .catch(() => 0);
}

/* A signature, in the form explorers and users quote it. */
export const solSigToString = (sig: Uint8Array): string => bs58.encode(sig);
