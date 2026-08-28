import { NextResponse } from "next/server";
import { jupQuote, jupImpact, mintDecimals, isSolAddress, WSOL, SOL_DECIMALS } from "@/lib/solana";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
  GET /api/solana/quote — what a trade would return, before committing to it.

  Priced from the aggregator, so the number quoted here is the number the swap
  route will build against. Sizing is done in raw mint units because a token's
  decimals are a property of the mint, never an assumption.
*/
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mint = String(u.searchParams.get("mint") ?? "");
  const side = u.searchParams.get("side") === "sell" ? "sell" : "buy";
  const amount = Number(u.searchParams.get("amount") ?? 0);

  if (!isSolAddress(mint)) {
    return NextResponse.json({ error: "Unknown token." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  }

  // the panel owns the slippage setting, exactly as it does on the EVM side
  const slippageBps = Math.min(5_000, Math.max(10, Number(u.searchParams.get("slippageBps") ?? 500)));

  const decimals = side === "buy" ? SOL_DECIMALS : await mintDecimals(mint);
  if (!decimals && side === "sell") {
    return NextResponse.json({ error: "Can't read that token." }, { status: 400 });
  }

  const amountRaw = BigInt(Math.floor(amount * 10 ** decimals));
  const quote = await jupQuote({
    inputMint: side === "buy" ? WSOL : mint,
    outputMint: side === "buy" ? mint : WSOL,
    amountRaw,
    slippageBps,
  });
  if (!quote) {
    return NextResponse.json({ error: "No route for that size." }, { status: 502 });
  }

  const outDecimals = side === "buy" ? await mintDecimals(mint) : SOL_DECIMALS;
  return NextResponse.json({
    out: Number(quote.outAmount) / 10 ** outDecimals,
    minOut: Number(quote.otherAmountThreshold) / 10 ** outDecimals,
    impactPct: jupImpact(quote) * 100,
    slippageBps,
  });
}
