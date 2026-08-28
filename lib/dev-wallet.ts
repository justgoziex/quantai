import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import bs58 from "bs58";
import { web3 } from "./solana-web3";
import { ed25519 } from "@noble/curves/ed25519";

/*
  Custodial deployer keys.

  A developer whose deployer lives in a script or a cold setup has no wallet to
  connect, so Quant AI holds the key for them.

  Keys are stored as they were given, at the desk's instruction, which makes
  the database itself the only thing standing between an attacker and these
  wallets — and they are the developers' wallets, not ours. Nothing in the API
  selects the column, so a key can only leave through direct database access.
*/

export type ParsedKey = { key: string; address: string; vm: "evm" | "svm" };

/*
  Read a pasted key, whichever chain it belongs to, and derive the address it
  controls.

  Deriving the address IS the proof of ownership — it can only be produced by
  holding the key, which is a stronger claim than a signature and needs no
  round-trip to the browser. A key that doesn't parse is rejected before
  anything touches storage.

  Three shapes are accepted, because those are the three people actually have:
  64 hex characters for EVM, and for Solana either the base58 secret a wallet
  exports or the JSON byte array a keypair file contains.
*/
export function readPrivateKey(input: string): ParsedKey | null {
  const raw = input.trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "");

  // ── EVM: 64 hex characters, with or without the prefix ──
  const hex = (compact.startsWith("0x") ? compact : `0x${compact}`) as Hex;
  if (/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    try {
      // EVM addresses are case-insensitive and stored lowercased everywhere
      return { key: hex, address: privateKeyToAccount(hex).address.toLowerCase(), vm: "evm" };
    } catch {
      return null;
    }
  }

  // ── Solana: the JSON byte array a keypair file holds ──
  if (raw.startsWith("[")) {
    try {
      return solanaFromSecret(Uint8Array.from(JSON.parse(raw) as number[]));
    } catch {
      return null;
    }
  }

  /*
    Solana: whatever the wallet exported.

    Length is not used to decide what this is — that was the mistake. A 64-byte
    secret encodes to 87 or 88 characters depending on its leading bytes, and a
    32-byte seed to 43 or 44, so a character-count window either rejects valid
    keys at the edges or accepts things it shouldn't. Decode first, then judge
    by the byte length, which is exact.
  */
  if (/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(compact)) {
    try {
      return solanaFromSecret(bs58.decode(compact));
    } catch {
      return null;
    }
  }

  return null;
}

/*
  Derive the address for a Solana secret, accepting both shapes wallets hand
  out: the full 64-byte keypair, and the 32-byte seed some tools export.

  Done arithmetically rather than through the Solana library — a 64-byte secret
  IS its seed followed by its public key, so the address is simply the second
  half. That removes a heavyweight import from a path that runs on every
  import attempt, and with it a whole class of runtime resolution failure.
*/
function solanaFromSecret(bytes: Uint8Array): ParsedKey | null {
  try {
    if (bytes.length === 64) {
      const address = bs58.encode(bytes.slice(32));
      return { key: bs58.encode(bytes), address, vm: "svm" };
    }
    if (bytes.length === 32) {
      // a seed on its own — the public half has to be computed
      const pub = ed25519.getPublicKey(bytes);
      const full = new Uint8Array(64);
      full.set(bytes, 0);
      full.set(pub, 32);
      return { key: bs58.encode(full), address: bs58.encode(pub), vm: "svm" };
    }
    return null;
  } catch {
    return null;
  }
}

/* An EVM account for signing as the developer's wallet. */
export function evmAccount(privateKey: string) {
  return privateKeyToAccount(privateKey as Hex);
}

/* The Solana keypair for a stored key. */
export async function solanaKeypair(privateKey: string) {
  // through the shared loader, which unwraps the library's CJS shape
  const { Keypair } = await web3();
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}
