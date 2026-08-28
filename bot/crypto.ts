import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/*
  Custodial key encryption. Private keys are AES-256-GCM encrypted at rest with
  a key derived from BOT_WALLET_SECRET (never the raw secret). We store the iv,
  auth tag, and ciphertext separately (all hex). Keys are decrypted only in
  memory, only at the moment of signing, and never logged.

  BOT_WALLET_SECRET must be a long, stable, high-entropy string — rotating it
  makes every stored wallet unrecoverable.
*/
const SECRET = process.env.BOT_WALLET_SECRET ?? "";

export function botCryptoConfigured(): boolean {
  return SECRET.length >= 16;
}

// derive a stable 32-byte key from the secret (scrypt, fixed salt so the same
// secret always yields the same key across cold starts)
function derivedKey(): Buffer {
  return scryptSync(SECRET, "quantai-bot-wallets-v1", 32);
}

export type Encrypted = { encKey: string; iv: string; tag: string };

export function encryptKey(plaintextHex: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintextHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encKey: enc.toString("hex"), iv: iv.toString("hex"), tag: tag.toString("hex") };
}

export function decryptKey(e: Encrypted): string {
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), Buffer.from(e.iv, "hex"));
  decipher.setAuthTag(Buffer.from(e.tag, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(e.encKey, "hex")), decipher.final()]);
  return dec.toString("utf8");
}
