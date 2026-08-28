import { NextResponse } from "next/server";
import { prisma, dbConfigured } from "@/lib/db";
import { dbUnavailable, badRequest } from "@/lib/api";
import type { Chain } from "@/lib/generated/prisma/enums";
import { normalizeAddress } from "@/lib/chains";

/* GET /api/tokens/[chain]/[address] — token detail + recent signals. */
export async function GET(
  _req: Request,
  { params }: { params: { chain: string; address: string } },
) {
  if (!dbConfigured) return dbUnavailable();
  const chain = params.chain.toUpperCase();
  if (!["ETH", "BSC", "BASE", "RH", "SOL"].includes(chain)) return badRequest("Unknown chain.");

  const token = await prisma.token.findFirst({
    where: {
      chain: chain as Chain,
      // base58 is case-sensitive; only EVM addresses are lowered
      address: normalizeAddress(chain.toLowerCase() as never, params.address),
      blacklisted: false,
    },
    include: { signals: { orderBy: { firedAt: "desc" }, take: 20 } },
  });

  if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  return NextResponse.json({ token });
}
