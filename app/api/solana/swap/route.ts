import { NextResponse } from "next/server";
import { jupQuote, jupImpact, jupSwapTx, mintDecimals, isSolAddress, WSOL, SOL_DECIMALS } from "@/lib/solana";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/*
  POST /api/solana/swap — build the transaction the user's wallet will sign.

  The transaction is assembled here and signed in the browser: the key never
  leaves the wallet, and nothing is submitted that the user hasn't approved.

  A blacklisted token is refused at this point rather than at the quote, so the
  refusal lands where it actually prevents a trade.
*/
export async function POST(req: Request) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    mint?: string;
    side?: string;
    amount?: number;
    owner?: string;
    slippageBps?: number;
  };
  const mint = String(body.mint ?? "");
  const owner = String(body.owner ?? "");
  const side = body.side === "sell" ? "sell" : "buy";
  const amount = Number(body.amount ?? 0);

  if (!isSolAddress(mint) || !isSolAddress(owner)) {
    return NextResponse.json({ error: "Unknown wallet or token." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  }

  const token = await prisma.token
    .findFirst({ where: { chain: "SOL", address: mint }, select: { blacklisted: true } })
    .catch(() => null);
  if (token?.blacklisted) {
    return NextResponse.json({ error: "This token isn't tradeable on Quant AI." }, { status: 403 });
  }

  const slippageBps = Math.min(5_000, Math.max(10, Number(body.slippageBps ?? 500)));

  /*
    A ceiling on how far a trade may move the price. Slippage is the user's
    choice; this is the desk refusing to route a size that a pool plainly can't
    absorb, which is how people lose most of a position in one click.
  */
  const maxImpactPct = 20;

  const decimals = side === "buy" ? SOL_DECIMALS : await mintDecimals(mint);
  const amountRaw = BigInt(Math.floor(amount * 10 ** decimals));

  const quote = await jupQuote({
    inputMint: side === "buy" ? WSOL : mint,
    outputMint: side === "buy" ? mint : WSOL,
    amountRaw,
    slippageBps,
  });
  if (!quote) return NextResponse.json({ error: "No route for that size." }, { status: 502 });

  /*
    Refuse a trade that would move the price against the user beyond the desk's
    limit. At this size the quote is the warning, and going ahead anyway is how
    people lose most of a position to a thin pool.
  */
  const impactPct = jupImpact(quote) * 100;
  if (impactPct > maxImpactPct) {
    return NextResponse.json(
      { error: `That size moves the price ${impactPct.toFixed(1)}%. Try a smaller amount.` },
      { status: 400 },
    );
  }

  const tx = await jupSwapTx({ quote, userPublicKey: owner });
  if (!tx) return NextResponse.json({ error: "Couldn't build that trade." }, { status: 502 });

  const outDecimals = side === "buy" ? await mintDecimals(mint) : SOL_DECIMALS;
  return NextResponse.json({
    transaction: tx,
    out: Number(quote.outAmount) / 10 ** outDecimals,
    minOut: Number(quote.otherAmountThreshold) / 10 ** outDecimals,
    impactPct,
  });
}
