import { NextResponse } from "next/server";
import { web3 } from "@/lib/solana-web3";
import { latestBlockhash, rentExemption } from "@/lib/solana";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/*
  GET /api/solana/health — can this runtime actually use Solana?

  Every other Solana route checks authentication first, so an unauthenticated
  request is turned away long before the library is touched. That made testing
  them from outside worthless: they answered "sign in required" whether the
  library worked or not, and a fix looked verified while still being broken.

  This exercises the same load path with nothing in front of it. It reports
  what loaded and what failed — no keys, no configuration values, nothing an
  outsider could use.
*/
export async function GET() {
  const out: Record<string, unknown> = {};

  try {
    const w = await web3();
    out.library = {
      loaded: true,
      publicKey: typeof w.PublicKey === "function",
      systemProgram: typeof w.SystemProgram === "object",
      transactionMessage: typeof w.TransactionMessage === "function",
      versionedTransaction: typeof w.VersionedTransaction === "function",
    };

    // build a throwaway transaction — the thing the fee route actually does
    const blockhash = await latestBlockhash();
    if (blockhash) {
      const key = new w.PublicKey("11111111111111111111111111111111");
      const message = new w.TransactionMessage({
        payerKey: key,
        recentBlockhash: blockhash,
        instructions: [
          w.SystemProgram.transfer({ fromPubkey: key, toPubkey: key, lamports: 1 }),
        ],
      }).compileToV0Message();
      out.buildsTransaction = new w.VersionedTransaction(message).serialize().length > 0;
    } else {
      out.buildsTransaction = false;
    }
  } catch (e) {
    out.library = { loaded: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }

  try {
    out.rpc = { blockhash: Boolean(await latestBlockhash()), rent: await rentExemption(82) };
  } catch (e) {
    out.rpc = { error: String((e as Error)?.message ?? e).slice(0, 200) };
  }

  return NextResponse.json(out);
}
