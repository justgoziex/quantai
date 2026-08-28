import { prisma, dbConfigured } from "@/lib/db";
import { solBalance } from "@/lib/solana";
import { requireUser, dbUnavailable } from "@/lib/api";
import { getNativeBalance } from "@/lib/rpc";
import { getNativeUsd } from "@/lib/native-price";
import { computePositions } from "@/lib/pnl";

/*
  GET /api/balance — the account's total value in USD, for the nav.
  Demo-aware (uses demo cash + simulated positions when enabled). Kept lean:
  numbers only, no trade log. Per-user memory cache (25s) absorbs the nav's
  polling so it never stacks RPC + DB work.
*/
const cache = new Map<string, { at: number; body: string }>();
const CACHE_MS = 25_000;

export async function GET(req: Request) {
  if (!dbConfigured) return dbUnavailable();
  const res = await requireUser(req);
  if ("error" in res) return res.error;

  // ?fresh=1 (fired right after a trade) bypasses the cache for an instant read
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const hit = cache.get(res.user.id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
    return new Response(hit.body, { headers: { "content-type": "application/json" } });
  }

  const demo = await prisma.demoAccount.findUnique({ where: { userId: res.user.id } });
  const isDemo = demo?.enabled ?? false;
  const wallet = await prisma.wallet.findFirst({
    where: { userId: res.user.id, provider: { not: "privy-solana" } },
  });
  const solWallet = await prisma.wallet.findFirst({
    where: { userId: res.user.id, provider: "privy-solana" },
  });

  const [ethBalance, bnbBalance, baseBalance, solBal, nativeUsd, trades] = await Promise.all([
    !isDemo && wallet ? getNativeBalance("eth", wallet.address) : Promise.resolve(null),
    !isDemo && wallet ? getNativeBalance("bsc", wallet.address) : Promise.resolve(null),
    !isDemo && wallet ? getNativeBalance("base", wallet.address) : Promise.resolve(null),
    !isDemo && solWallet ? solBalance(solWallet.address).catch(() => null) : Promise.resolve(null),
    getNativeUsd(),
    prisma.trade.findMany({
      where: { userId: res.user.id, demo: isDemo },
      select: { tokenId: true, side: true, amountToken: true, priceUsd: true, occurredAt: true },
    }),
  ]);

  const positionMap = computePositions(trades);
  const tokenIds = Array.from(positionMap.values())
    .filter((p) => p.qty > 0)
    .map((p) => p.tokenId);
  const tokens = tokenIds.length
    ? await prisma.token.findMany({ where: { id: { in: tokenIds } }, select: { id: true, market: true } })
    : [];
  const priceById = new Map(
    tokens.map((t) => [t.id, ((t.market ?? {}) as { priceUsd?: number }).priceUsd ?? 0]),
  );

  const holdingsUsd = Array.from(positionMap.values()).reduce(
    (s, p) => s + (p.qty > 0 ? p.qty * (priceById.get(p.tokenId) ?? 0) : 0),
    0,
  );
  // Base is an ETH-gas chain, so its native balance is valued at the ETH price
  const cashUsd = isDemo
    ? (demo?.cashUsd ?? 0)
    : ((ethBalance ?? 0) + (baseBalance ?? 0)) * nativeUsd.eth +
      (bnbBalance ?? 0) * nativeUsd.bnb +
      (solBal ?? 0) * nativeUsd.sol;

  const body = JSON.stringify({
    totalUsd: cashUsd + holdingsUsd,
    cashUsd,
    holdingsUsd,
    nativeUsd,
    // per-chain cash, so the account page can show what sits where
    native: { eth: ethBalance ?? 0, bnb: bnbBalance ?? 0, base: baseBalance ?? 0, sol: solBal ?? 0 },
  });
  cache.set(res.user.id, { at: Date.now(), body });
  return new Response(body, { headers: { "content-type": "application/json" } });
}
