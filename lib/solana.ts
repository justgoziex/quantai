/*
  Solana execution layer — the SVM counterpart to lib/dex.ts.

  Nothing here shares code with the EVM path: no ABIs, no approvals, no viem.
  Balances come from plain JSON-RPC so the module stays dependency-light, and
  swaps route through Jupiter, which aggregates Raydium, Orca, Meteora and the
  pump.fun curve behind one quote.
*/

/*
  Helius when a key is configured — the free endpoints block the indexed methods
  (largest accounts, holder lookups) that scoring depends on, and rate-limit the
  rest. Falls back to a keyless public node so nothing breaks without it.
*/
export const SOL_RPC = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : (process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com");

/* Wrapped SOL — Jupiter's stand-in for native SOL on both sides of a route. */
export const WSOL = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;

/*
  A Solana address is base58 and 32–44 characters — no 0x, no fixed length, and
  the alphabet excludes 0, O, I and l. Used everywhere the EVM path would test
  for /^0x[0-9a-f]{40}$/.
*/
export const isSolAddress = (a: string): boolean =>
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a ?? "").trim());

type RpcResult<T> = { result?: T; error?: { message?: string } };

/*
  One RPC call, with retry on a refusal.

  This backs balances, sizing and fee verification, so returning null the
  moment the provider says "slow down" is the worst possible answer: a held
  balance reads as zero, and a trade that should work is refused for a reason
  the user can't act on. A rate-limit is a wait, not a no.
*/
async function rpc<T>(method: string, params: unknown[], attempt = 0): Promise<T | null> {
  try {
    const r = await fetch(SOL_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) + Math.random() * 250));
      return rpc<T>(method, params, attempt + 1);
    }
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as RpcResult<T> | null;
    if (j?.error && /rate|limit|busy|exceeded/i.test(j.error.message ?? "") && attempt < 3) {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) + Math.random() * 250));
      return rpc<T>(method, params, attempt + 1);
    }
    return j?.result ?? null;
  } catch {
    if (attempt < 2) {
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
      return rpc<T>(method, params, attempt + 1);
    }
    return null;
  }
}

/* Native SOL balance, in SOL. */
export async function solBalance(owner: string): Promise<number> {
  const res = await rpc<{ value: number }>("getBalance", [owner]);
  return res ? Number(res.value) / 10 ** SOL_DECIMALS : 0;
}

/*
  SPL token balance for one mint. Solana holds each token in a separate account
  owned by the wallet, so this asks for the accounts filtered by mint rather
  than calling a balanceOf.
*/
export async function splBalance(
  owner: string,
  mint: string,
): Promise<{ amount: bigint; decimals: number; ui: number }> {
  const res = await rpc<{
    value: {
      account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } };
    }[];
  }>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);

  let amount = 0n;
  let decimals = 0;
  for (const acc of res?.value ?? []) {
    const t = acc?.account?.data?.parsed?.info?.tokenAmount;
    if (!t) continue;
    amount += BigInt(t.amount || "0");
    decimals = Number(t.decimals) || decimals;
  }
  return { amount, decimals, ui: decimals > 0 ? Number(amount) / 10 ** decimals : Number(amount) };
}

/* Decimals for a mint, straight from the account. */
export async function mintDecimals(mint: string): Promise<number> {
  const res = await rpc<{ value: { data: { parsed: { info: { decimals: number } } } } }>(
    "getAccountInfo",
    [mint, { encoding: "jsonParsed" }],
  );
  const d = res?.value?.data?.parsed?.info?.decimals;
  return Number.isFinite(d) ? Number(d) : 9;
}

/* Has this transaction landed and succeeded? */
export async function solTxSucceeded(signature: string): Promise<boolean | null> {
  const res = await rpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
  );
  const st = res?.value?.[0];
  if (!st) return null; // not seen yet — still pending
  if (st.err) return false;
  return st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized";
}

/* ── Jupiter ─────────────────────────────────────────────────── */

const JUP = process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag/swap/v1";

export type JupQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string; // the guaranteed minimum after slippage
  priceImpactPct: string;
  routePlan: unknown[];
};

/*
  Quote a swap. Amounts are raw (lamports for SOL, mint units for SPL).
  `lite-api` is the keyless tier; JUPITER_API_URL can point at the paid host
  once volume justifies it.
*/
export async function jupQuote(opts: {
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  slippageBps?: number;
}): Promise<JupQuote | null> {
  try {
    const q = new URLSearchParams({
      inputMint: opts.inputMint,
      outputMint: opts.outputMint,
      amount: opts.amountRaw.toString(),
      slippageBps: String(opts.slippageBps ?? 300),
    });
    const r = await fetch(`${JUP}/quote?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as JupQuote | null;
    return j?.outAmount ? j : null;
  } catch {
    return null;
  }
}

/*
  Turn a quote into a signable transaction. Jupiter returns a base64
  VersionedTransaction that the wallet signs and sends as-is — there is no
  approval step, and no calldata for us to assemble.
*/
export async function jupSwapTx(opts: {
  quote: JupQuote;
  userPublicKey: string;
  priorityLamports?: number;
}): Promise<string | null> {
  try {
    const r = await fetch(`${JUP}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        quoteResponse: opts.quote,
        userPublicKey: opts.userPublicKey,
        // let Jupiter open and close the wrapped-SOL account for us
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: opts.priorityLamports ?? "auto",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { swapTransaction?: string } | null;
    return j?.swapTransaction ?? null;
  } catch {
    return null;
  }
}

/* Human-readable price impact, 0–1, matching how the EVM path reports it. */
export function jupImpact(q: JupQuote): number {
  const n = Number(q.priceImpactPct);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

/* ── proof of ownership ──────────────────────────────────────── */

/*
  Verify a wallet signed a message. Solana signs with ed25519 over the raw
  message bytes — there is no EIP-191 prefix and no recovery, so unlike the EVM
  path the public key has to be supplied (it IS the address).
*/
export async function verifySolSignature(
  message: string,
  signatureB58: string,
  addressB58: string,
): Promise<boolean> {
  try {
    if (!isSolAddress(addressB58)) return false;
    const [{ ed25519 }, bs58] = await Promise.all([
      import("@noble/curves/ed25519"),
      import("bs58").then((m) => m.default ?? m),
    ]);
    const pub = bs58.decode(addressB58);
    // wallets hand signatures back as base58; tolerate base64 too
    let sig: Uint8Array;
    try {
      sig = bs58.decode(signatureB58);
    } catch {
      sig = Uint8Array.from(Buffer.from(signatureB58, "base64"));
    }
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed25519.verify(sig, new TextEncoder().encode(message), pub);
  } catch {
    return false;
  }
}

/* ── fee payments ────────────────────────────────────────────── */

export type SolFeeCheck = {
  ok: boolean;
  pending?: boolean;
  error?: string;
  from?: string;
  paidSol?: number;
};

/*
  Confirm a SOL transfer landed in the fee wallet.

  Solana has no `tx.to` and no `tx.value` — a transaction is a bundle of
  instructions. The dependable read is the balance delta: compare the fee
  wallet's pre and post balance for this transaction and see what it gained.
  That works whether the payment came from a plain transfer, a wallet batch or
  a program call.
*/
export async function verifySolFeePayment(
  signature: string,
  expectedSol: number,
  feeWallet: string,
  tolerancePct = 0,
): Promise<SolFeeCheck> {
  if (!signature || signature.length < 60) return { ok: false, error: "That transaction signature isn't valid." };
  if (!isSolAddress(feeWallet)) return { ok: false, error: "Payments aren't configured yet — contact the desk." };

  const tx = await rpc<{
    meta: { err: unknown; preBalances: number[]; postBalances: number[] } | null;
    transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
  }>("getTransaction", [
    signature,
    { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
  ]);

  if (!tx) return { ok: false, pending: true, error: "Payment is still confirming — try again in a moment." };
  if (tx.meta?.err) return { ok: false, error: "That payment failed on-chain." };

  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k.pubkey,
  );
  const idx = keys.indexOf(feeWallet);
  if (idx < 0) return { ok: false, error: "Payment wasn't sent to the Quant AI payment address." };

  const pre = Number(tx.meta?.preBalances?.[idx] ?? 0);
  const post = Number(tx.meta?.postBalances?.[idx] ?? 0);
  const paidSol = (post - pre) / 10 ** SOL_DECIMALS;

  const floor = expectedSol * (1 - Math.max(0, Math.min(50, tolerancePct)) / 100);
  if (paidSol + 1e-9 < floor) {
    return { ok: false, error: `The fee is ${expectedSol} — that payment was ${paidSol.toFixed(6)}.` };
  }
  return { ok: true, from: keys[0], paidSol };
}

/*
  Who controls a mint. Solana has no "contract deployer" in the EVM sense, so
  ownership of a token is proved through the mint's own authorities and the
  Metaplex metadata: the update authority can rewrite the token's identity, and
  listed creators are baked in at mint time. Either is a credible claim.
*/
export async function solTokenAuthorities(mint: string): Promise<{
  mintAuthority: string | null;
  freezeAuthority: string | null;
  updateAuthority: string | null;
  creators: string[];
}> {
  const out = { mintAuthority: null as string | null, freezeAuthority: null as string | null, updateAuthority: null as string | null, creators: [] as string[] };

  const acc = await rpc<{
    value: { data: { parsed: { info: { mintAuthority?: string | null; freezeAuthority?: string | null } } } } | null;
  }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc?.value?.data?.parsed?.info;
  if (info) {
    out.mintAuthority = info.mintAuthority ?? null;
    out.freezeAuthority = info.freezeAuthority ?? null;
  }

  // metadata lives in a separate account; GoPlus already surfaces it parsed
  try {
    const r = await fetch(
      `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) },
    );
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const t = (j?.result ?? {})[mint];
      const upd = t?.metadata_mutable?.metadata_upgrade_authority;
      if (Array.isArray(upd) && upd[0]?.address) out.updateAuthority = String(upd[0].address);
      if (Array.isArray(t?.creators)) {
        out.creators = t.creators.map((c: { address?: string }) => String(c?.address ?? "")).filter(Boolean);
      }
    }
  } catch {
    /* authorities from the mint account alone are still usable */
  }
  return out;
}

/*
  Does this wallet have a credible claim to this mint? Mirrors what the EVM
  deployer scan proves, using what Solana actually exposes.
*/
export async function solControlsMint(wallet: string, mint: string): Promise<boolean> {
  if (!isSolAddress(wallet) || !isSolAddress(mint)) return false;
  const a = await solTokenAuthorities(mint);
  return (
    a.updateAuthority === wallet ||
    a.mintAuthority === wallet ||
    a.freezeAuthority === wallet ||
    a.creators.includes(wallet)
  );
}

/*
  Latest blockhash, over plain JSON-RPC.

  The library's Connection class would do this too, but it pulls in a
  websocket client whose own dependencies clash in a serverless runtime — a
  transaction builder shouldn't drag a subscription stack behind it just to
  read one value.
*/
export async function latestBlockhash(): Promise<string | null> {
  const res = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  return res?.value?.blockhash ?? null;
}

/* Minimum lamports for an account of this size to be rent-exempt. */
export async function rentExemption(bytes: number): Promise<number | null> {
  const res = await rpc<number>("getMinimumBalanceForRentExemption", [bytes]);
  return typeof res === "number" ? res : null;
}
