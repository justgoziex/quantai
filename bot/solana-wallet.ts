import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/db";
import { decryptKey } from "./crypto";

/*
  The bot's Solana wallet.

  Each user already has one encrypted secret — their EVM key — and the store
  holds exactly one wallet per user. Rather than introduce a second secret to
  encrypt, back up and leak, the Solana keypair is derived from the existing
  one through a one-way hash with its own domain tag.

  That gives a stable address (the same user always resolves to the same
  Solana wallet), nothing extra at rest, and no path back to the EVM key from
  the Solana one. The domain tag is what keeps the two independent: without it,
  a leaked Solana seed would be the EVM key.
*/

const DOMAIN = "quantai:solana:v1";

function keypairFromEvmKey(evmPrivateKey: string): Keypair {
  const seed = createHash("sha256")
    .update(DOMAIN)
    .update(evmPrivateKey.replace(/^0x/, "").toLowerCase())
    .digest(); // 32 bytes, exactly what ed25519 wants
  return Keypair.fromSeed(seed);
}

async function loadKey(botUserId: string): Promise<string | null> {
  const w = await prisma.botWallet.findUnique({ where: { botUserId } });
  if (!w) return null;
  return decryptKey({ encKey: w.encKey, iv: w.iv, tag: w.tag });
}

/* The signing keypair. In memory only — never persisted, never logged. */
export async function getSolanaKeypair(botUserId: string): Promise<Keypair | null> {
  const pk = await loadKey(botUserId);
  return pk ? keypairFromEvmKey(pk) : null;
}

/* The user's Solana address (base58), or null if they have no wallet yet. */
export async function getSolanaAddress(botUserId: string): Promise<string | null> {
  const kp = await getSolanaKeypair(botUserId);
  return kp ? kp.publicKey.toBase58() : null;
}

/*
  The Solana secret key, for the export flow only — the same care as the EVM
  export. Base58 is the form Phantom and Solflare expect on import.
*/
export async function exportSolanaKey(botUserId: string): Promise<string | null> {
  const kp = await getSolanaKeypair(botUserId);
  return kp ? bs58.encode(kp.secretKey) : null;
}
