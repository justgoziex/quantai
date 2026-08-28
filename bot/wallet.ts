import { createWalletClient, http, formatEther, type Account, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { mainnet, bsc } from "viem/chains";
import { prisma } from "@/lib/db";
import { publicClient, robinhoodChain, RPC } from "@/lib/dex";
import type { ChainId, EvmChainId } from "@/lib/chains";
import { encryptKey, decryptKey } from "./crypto";

/*
  Custodial wallet management for bot users. One EVM keypair per user works
  across ETH / BSC / Robinhood (same address). The private key is only ever
  decrypted here, in memory, to build a signer — never returned to callers
  except the explicit export flow.
*/
export type BotUserRow = {
  id: string;
  chatId: string;
  lang: string;
  /*
    Every chain the bot trades, not just the EVM ones. This was EvmChainId,
    which made "sol" impossible to represent and quietly forced every Solana
    code path to cast its way around the type.
  */
  chain: ChainId;
  slippageBps: number;
  state: unknown;
};

const chainObj = (chain: EvmChainId) => (chain === "eth" ? mainnet : chain === "bsc" ? bsc : robinhoodChain);

/* Get the bot user for a chat, creating the user + wallet on first contact. */
export async function getOrCreateUser(chatId: string, username?: string): Promise<BotUserRow> {
  const existing = await prisma.botUser.findUnique({ where: { chatId } });
  if (existing) return existing as unknown as BotUserRow;

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address.toLowerCase();
  const enc = encryptKey(pk);

  const user = await prisma.botUser.create({
    data: {
      chatId,
      username: username ?? null,
      wallet: { create: { address, ...enc } },
    },
  });
  return user as unknown as BotUserRow;
}

export async function getWalletAddress(botUserId: string): Promise<string | null> {
  const w = await prisma.botWallet.findUnique({ where: { botUserId }, select: { address: true } });
  return w?.address ?? null;
}

/* Decrypt the key and build a viem account. Handle with care — in memory only. */
export async function getAccount(botUserId: string): Promise<Account | null> {
  const w = await prisma.botWallet.findUnique({ where: { botUserId } });
  if (!w) return null;
  const pk = decryptKey({ encKey: w.encKey, iv: w.iv, tag: w.tag }) as Hex;
  return privateKeyToAccount(pk);
}

/* The raw private key, for the export flow only. */
export async function exportPrivateKey(botUserId: string): Promise<string | null> {
  const w = await prisma.botWallet.findUnique({ where: { botUserId } });
  if (!w) return null;
  return decryptKey({ encKey: w.encKey, iv: w.iv, tag: w.tag });
}

/* Replace the user's wallet from an imported private key. */
export async function importPrivateKey(botUserId: string, pkInput: string): Promise<string | null> {
  const pk = (pkInput.trim().startsWith("0x") ? pkInput.trim() : `0x${pkInput.trim()}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return null;
  let address: string;
  try {
    address = privateKeyToAccount(pk).address.toLowerCase();
  } catch {
    return null;
  }
  const enc = encryptKey(pk);
  await prisma.botWallet.upsert({
    where: { botUserId },
    update: { address, ...enc },
    create: { botUserId, address, ...enc },
  });
  return address;
}

export function walletClientFor(account: Account, chain: EvmChainId) {
  return createWalletClient({ account, chain: chainObj(chain), transport: http(RPC[chain]) });
}

/* Native balance (ETH/BNB) on one chain, as a float. */
export async function nativeBalance(chain: EvmChainId, address: string): Promise<number> {
  try {
    const bal = await publicClient(chain).getBalance({ address: address as `0x${string}` });
    return Number(formatEther(bal));
  } catch {
    return 0;
  }
}
