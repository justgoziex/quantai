import type { ChainId, EvmChainId } from "@/lib/chains";
import { isEvm } from "@/lib/chains";
import { getAccount, nativeBalance } from "./wallet";
import { getSolanaKeypair, getSolanaAddress } from "./solana-wallet";
import { executeBuy, executeSell, heldBalance, toWei, type SwapResult } from "./swap";
import { executeSolBuy, executeSolSell, solHeldBalance } from "./solana-swap";
import { solBalance } from "@/lib/solana";
import { prisma } from "@/lib/db";

/*
  One trading surface for every chain the bot supports.

  The handlers ask to buy or sell and shouldn't care which virtual machine is
  underneath — the EVM path needs an approval, a router and wei; the Solana
  path needs a signed transaction from the aggregator and raw mint units.
  Branching at each of the twenty-odd call sites in the handlers would have
  meant twenty places to get it wrong, so the difference is resolved once,
  here.
*/

/* The wallet address to show and trade from, for whichever chain is active. */
export async function walletAddressFor(
  botUserId: string,
  chain: ChainId,
): Promise<string | null> {
  if (chain === "sol") return getSolanaAddress(botUserId);
  const acct = await getAccount(botUserId);
  return acct?.address ?? null;
}

/* Spendable native balance — SOL, or the EVM chain's gas token. */
export async function nativeBalanceFor(
  botUserId: string,
  chain: ChainId,
  evmAddress?: string,
): Promise<number> {
  if (chain === "sol") {
    const addr = await getSolanaAddress(botUserId);
    return addr ? solBalance(addr).catch(() => 0) : 0;
  }
  const addr = evmAddress ?? (await getAccount(botUserId))?.address;
  return addr ? nativeBalance(chain as EvmChainId, addr) : 0;
}

/* How much of a token the user holds, as a display figure. */
export async function heldFor(
  botUserId: string,
  chain: ChainId,
  tokenAddress: string,
): Promise<number> {
  if (chain === "sol") {
    const addr = await getSolanaAddress(botUserId);
    return addr ? solHeldBalance(addr, tokenAddress) : 0;
  }
  const acct = await getAccount(botUserId);
  if (!acct) return 0;
  const h = await heldBalance(
    chain as EvmChainId,
    tokenAddress as `0x${string}`,
    acct.address as `0x${string}`,
  );
  return Number(h.raw) / 10 ** h.decimals;
}

/* Buy `amountNative` worth of a token. */
export async function buyFor(
  botUserId: string,
  chain: ChainId,
  tokenAddress: string,
  amountNative: number,
  slippageBps: number,
  decimals: number,
): Promise<SwapResult> {
  if (chain === "sol") {
    const kp = await getSolanaKeypair(botUserId);
    if (!kp) return { ok: false, error: "No wallet yet." };
    return executeSolBuy(kp, tokenAddress, amountNative, slippageBps);
  }
  const acct = await getAccount(botUserId);
  if (!acct) return { ok: false, error: "No wallet yet." };
  return executeBuy(
    acct,
    chain as EvmChainId,
    tokenAddress as `0x${string}`,
    toWei(amountNative, 18),
    slippageBps,
    decimals,
  );
}

/* Sell a percentage of the held position. */
export async function sellFor(
  botUserId: string,
  chain: ChainId,
  tokenAddress: string,
  pct: number,
  slippageBps: number,
): Promise<SwapResult> {
  if (chain === "sol") {
    const kp = await getSolanaKeypair(botUserId);
    if (!kp) return { ok: false, error: "No wallet yet." };
    return executeSolSell(kp, tokenAddress, pct, slippageBps);
  }
  const acct = await getAccount(botUserId);
  if (!acct) return { ok: false, error: "No wallet yet." };
  const held = await heldBalance(
    chain as EvmChainId,
    tokenAddress as `0x${string}`,
    acct.address as `0x${string}`,
  );
  if (held.raw <= 0n) return { ok: false, error: "Nothing to sell." };
  const sellRaw = (held.raw * BigInt(Math.min(100, Math.max(1, Math.round(pct))))) / 100n;
  return executeSell(
    acct,
    chain as EvmChainId,
    tokenAddress as `0x${string}`,
    sellRaw,
    slippageBps,
    held.decimals,
  );
}

/*
  Resolve a pasted address to a token the bot can trade. Solana addresses are
  base58 and case-carrying, so the lookup has to preserve them exactly — the
  EVM path's lowercasing would turn a valid mint into one that matches nothing.
*/
export async function resolveTokenAny(chain: ChainId, input: string) {
  const raw = input.trim();
  const address = chain === "sol" ? raw : raw.toLowerCase();
  const chainEnum = chain.toUpperCase() as never;
  const t = await prisma.token.findFirst({
    where: { chain: chainEnum, address, blacklisted: false },
    select: { address: true, symbol: true, name: true, currentScore: true, market: true },
  });
  if (!t) return null;
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    // Solana mints carry their own decimals; the EVM side reads them on-chain
    decimals: 0,
    score: t.currentScore,
    priceUsd: Number((t.market as { priceUsd?: number } | null)?.priceUsd ?? 0),
  };
}

export const chainIsEvm = (chain: ChainId): chain is EvmChainId => isEvm(chain);
