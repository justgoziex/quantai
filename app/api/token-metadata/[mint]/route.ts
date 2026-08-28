import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isSolAddress } from "@/lib/solana";

export const dynamic = "force-dynamic";

/*
  GET /api/token-metadata/[mint] — the token's name, symbol and image, in the
  shape wallets expect.

  Metaplex stores only a URL on-chain; the descriptive part lives wherever that
  URL points. The usual answer is Arweave or IPFS, which cost money to pin and
  need an account. Serving it from here costs nothing and needs no storage, and
  the JSON is generated from the launch record rather than a file, so it can't
  drift from what was actually minted.

  The honest trade-off: this lives as long as Quant AI does. For a memecoin
  that's the same lifetime as the screener it trades on, but a project that
  outgrows this should move its metadata onto permanent storage — the field is
  mutable, so they can, without reminting.
*/
export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  const mint = String(params.mint ?? "").trim();
  if (!isSolAddress(mint)) {
    return NextResponse.json({ error: "Unknown token." }, { status: 400 });
  }

  /*
    Read from the launch record, not the catalogue. The launch is what was
    actually minted, so the JSON can't drift from the token it describes — and
    it exists the moment the mint does, before any indexer has noticed it.
  */
  const token = await prisma.launchConfig
    .findFirst({
      where: { chain: "SOL", contractAddress: mint },
      orderBy: { createdAt: "desc" },
      select: { name: true, symbol: true, logoUrl: true, description: true },
    })
    .catch(() => null);

  if (!token) return NextResponse.json({ error: "Unknown token." }, { status: 404 });

  return NextResponse.json(
    {
      name: token.name,
      symbol: token.symbol,
      description: token.description ?? "",
      image: token.logoUrl ?? "",
      // wallets read the image from here as well as the top level
      properties: token.logoUrl ? { files: [{ uri: token.logoUrl, type: "image/png" }] } : {},
    },
    {
      headers: {
        "cache-control": "public, max-age=300, s-maxage=300",
        // wallets fetch this from their own origin
        "access-control-allow-origin": "*",
      },
    },
  );
}
