import { NextResponse } from "next/server";
import { web3 } from "@/lib/solana-web3";
import { withErrors } from "@/lib/route-errors";
import { isSolAddress, solBalance, latestBlockhash } from "@/lib/solana";
import { requireUser } from "@/lib/api";
import { getMonetization } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
  POST /api/solana/fee-tx — the listing-fee payment, ready to sign.

  On Solana a fee is a single transfer: no allowance to grant, no router to
  route through, nothing to batch. So the whole payment is one transaction and
  one confirmation, and it is built here so the amount and the destination are
  the desk's, not something the browser could be talked into changing.
*/
async function postHandler(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { owner?: string };
  const owner = String(body.owner ?? "");
  if (!isSolAddress(owner)) {
    return NextResponse.json({ error: "Connect a Solana wallet to pay the fee." }, { status: 400 });
  }

  const mon = await getMonetization().catch(() => null);
  const feeWallet = String(mon?.feeWalletSol ?? "");
  const feeSol = Number(mon?.devListingFeeSol ?? 0);
  if (!isSolAddress(feeWallet) || !(feeSol > 0)) {
    return NextResponse.json(
      { error: "Listing payments aren't set up yet — contact the desk." },
      { status: 503 },
    );
  }

  /*
    Loaded when the route runs, not when the module loads.

    Bundled as a top-level import, this library's classes arrive as a namespace
    object rather than constructors — `new PublicKey(...)` then fails with "is
    not a constructor", which is an uncaught throw and an empty 500. The same
    thing broke the launcher build; importing on use is what fixes both.
  */
  // no Connection: its websocket client breaks in this runtime, and the two
  // reads it would perform are already available over plain JSON-RPC
  const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, LAMPORTS_PER_SOL } =
    await web3();

  const lamports = Math.round(feeSol * LAMPORTS_PER_SOL);
  const from = new PublicKey(owner);

  const balance = Math.round((await solBalance(owner).catch(() => 0)) * LAMPORTS_PER_SOL);
  // leave headroom for the network fee itself, or the transfer simply fails
  if (balance < lamports + 10_000) {
    /*
      Name the wallet and the numbers. "Not enough balance" on its own is
      unactionable when several wallets are connected — the one being charged
      may not be the one the developer funded.
    */
    return NextResponse.json(
      {
        error: `Not enough SOL in ${owner.slice(0, 4)}…${owner.slice(-4)} — it holds ${(
          balance / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL and the fee needs ${(lamports / LAMPORTS_PER_SOL).toFixed(4)}.`,
      },
      { status: 400 },
    );
  }

  const blockhash = await latestBlockhash();
  if (!blockhash) {
    return NextResponse.json({ error: "Couldn't reach Solana right now." }, { status: 503 });
  }
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(feeWallet), lamports }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  return NextResponse.json({
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    feeSol,
  });
}

export const POST = withErrors("solana.fee-tx", postHandler);
