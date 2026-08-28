import { NextResponse } from "next/server";
import { formatUnits, type Address } from "viem";
import { prisma, dbConfigured } from "@/lib/db";
import { requireUser, dbUnavailable } from "@/lib/api";
import { publicClient, ERC20_ABI } from "@/lib/dex";
import { getNativeUsd, nativeUsdFor } from "@/lib/native-price";
import { getMonetization } from "@/lib/config";
import type { ChainId, EvmChainId } from "@/lib/chains";
import type { Chain } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

/*
  What the caller could pay a fee with on `chain` — their native balance plus
  any indexed token they actually hold. Used by the one-click fee flow: the
  client picks the first holding whose value covers the fee, swaps it to the
  native token, and forwards the fee. Balances are read live from chain.
*/
const CHAINS: ChainId[] = ["eth", "bsc", "base", "rh"];

export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  const url = new URL(req.url);
  const chain = (url.searchParams.get("chain") ?? "eth") as ChainId;
  if (!CHAINS.includes(chain as EvmChainId)) return NextResponse.json({ holdings: [], nativeUsd: 0 });
  const extra = url.searchParams.get("include")?.toLowerCase();

  const chainEnum = chain.toUpperCase() as Chain;

  /*
    Balances are read for whichever address is going to send the payment. A dev
    listing from an external wallet holds their supply there, not in the account
    wallet, so `owner` may name it — but only if it really belongs to the caller
    (an account wallet or one of their verified dev wallets).
  */
  const requested = url.searchParams.get("owner")?.toLowerCase();
  const [accountWallets, devProfiles] = await Promise.all([
    prisma.wallet.findMany({
      where: { userId: res.user.id },
      orderBy: { createdAt: "asc" },
      select: { address: true },
    }),
    prisma.devProfile.findMany({ where: { userId: res.user.id }, select: { wallet: true } }),
  ]);
  const mine = new Set([
    /*
      Lowercased for comparison only. This set decides which wallets a fee may
      be drawn from, and it's an EVM-only path — a Solana wallet reaching here
      would be compared in a form it never has, so it's left out deliberately
      rather than silently mismatched.
    */
    ...accountWallets.map((w) => w.address.toLowerCase()),
    ...devProfiles.filter((d) => d.wallet.startsWith("0x")).map((d) => d.wallet.toLowerCase()),
  ]);

  const ownerAddr =
    requested && /^0x[0-9a-f]{40}$/.test(requested) && mine.has(requested)
      ? requested
      : accountWallets[0]?.address.toLowerCase();
  if (!ownerAddr) return NextResponse.json({ holdings: [], nativeUsd: 0, wallet: null });
  const owner = ownerAddr as Address;

  const byAddr = new Map<string, { address: string; symbol: string; decimals: number; priceUsd: number }>();
  const add = (t: { address: string; symbol: string; decimals: number; market: unknown }) => {
    const m = (t.market ?? {}) as { priceUsd?: number };
    byAddr.set(t.address, {
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      priceUsd: Number(m.priceUsd) || 0,
    });
  };

  /*
    Every token the desk has attributed to this wallet counts, whether or not it
    has ever been traded on Quant AI. A dev's supply is a real holding and there
    is no reason to make them trade here first before they can spend it.
  */
  const attributed = await prisma.devTokenAttribution.findMany({
    where: { chain: chainEnum, wallet: { in: [...mine] } },
    select: { tokenAddress: true },
  });
  if (attributed.length > 0) {
    const rows = await prisma.token.findMany({
      where: { chain: chainEnum, address: { in: attributed.map((a) => a.tokenAddress) } },
      select: { address: true, symbol: true, decimals: true, market: true },
    });
    rows.forEach(add);
  }

  // anything they've traded here also counts
  const traded = await prisma.trade.findMany({
    where: { userId: res.user.id, demo: false, token: { chain: chainEnum, blacklisted: false } },
    select: { token: { select: { address: true, symbol: true, decimals: true, market: true } } },
    take: 200,
  });
  traded.forEach((t) => add(t.token));

  /*
    The token being listed is itself a valid way to pay — blacklisted included,
    since "blacklisted" here only means it isn't on Quant AI yet.
  */
  if (extra && /^0x[0-9a-f]{40}$/.test(extra) && !byAddr.has(extra)) {
    const row = await prisma.token.findFirst({
      where: { chain: chainEnum, address: extra },
      select: { address: true, symbol: true, decimals: true, market: true },
    });
    if (row) add(row);
  }

  const client = publicClient(chain as EvmChainId);
  const [nativeWei, nativeUsd, mon] = await Promise.all([
    client.getBalance({ address: owner }).catch(() => 0n),
    getNativeUsd(),
    getMonetization(),
  ]);

  const candidates = [...byAddr.values()].slice(0, 25);
  const balances = await Promise.all(
    candidates.map(async (c) => {
      try {
        /*
          Decimals come from the CONTRACT, never the catalog. The indexer
          doesn't populate them (everything defaults to 18), and a wrong
          value here would mis-size the sell by orders of magnitude — e.g.
          a 6-decimal token would round up to the entire balance.
        */
        const [bal, dec] = await Promise.all([
          client.readContract({
            address: c.address as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [owner],
          }) as Promise<bigint>,
          client
            .readContract({ address: c.address as Address, abi: ERC20_ABI, functionName: "decimals" })
            .catch(() => 18),
        ]);
        const decimals = Number(dec) || 18;
        return { ...c, decimals, balanceRaw: bal.toString(), balance: Number(formatUnits(bal, decimals)) };
      } catch {
        return null;
      }
    }),
  );

  const px = nativeUsdFor(chain, nativeUsd);
  const holdings = balances
    .filter((b): b is NonNullable<typeof b> => b !== null && b.balance > 0 && b.priceUsd > 0)
    .map((b) => ({
      address: b.address,
      symbol: b.symbol,
      decimals: b.decimals,
      balanceRaw: b.balanceRaw,
      balance: b.balance,
      priceUsd: b.priceUsd,
      valueUsd: b.balance * b.priceUsd,
      // nominal value in the native token — the real figure comes from a live
      // swap quote before anything is charged
      valueNative: px > 0 ? (b.balance * b.priceUsd) / px : 0,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);

  return NextResponse.json({
    wallet: owner,
    nativeBalance: Number(formatUnits(nativeWei, 18)),
    nativeUsd: px,
    feeWallet: mon.feeWallet,
    feeTolerancePct: mon.feeTolerancePct ?? 0,
    holdings,
  });
}
