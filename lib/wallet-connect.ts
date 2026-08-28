/*
  Direct wallet connection, for proving ownership of a wallet.

  This deliberately does not go through the account layer. Proving you control
  a deployer wallet is a one-off signature, not a statement about who you are —
  attaching it to the account meant a developer's deployer became part of their
  Quant identity, and attaching one that was already attached simply failed.

  So this talks to the wallet itself, the way every other dApp does: discover
  what's installed, ask it to connect, ask it to sign, and forget about it. The
  wallet is never stored, never linked, and the account is untouched.

  Two standards, because the two ecosystems settled on different ones:
    EVM    — EIP-6963, where wallets announce themselves on request
    Solana — the Wallet Standard registry
*/

export type DetectedWallet = {
  id: string;
  name: string;
  icon: string;
  vm: "evm" | "svm";
};

export type SignedProof = {
  address: string;
  message: string;
  signature: string;
  chain: "ETH" | "SOL";
};

/* ── EVM, via EIP-6963 ─────────────────────────────────────────── */

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
type Eip6963Detail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
};

const evmProviders = new Map<string, Eip6963Detail>();

/*
  Wallets announce themselves when asked. The listener has to be in place
  before the request, because the announcements arrive synchronously.
*/
function discoverEvm(): Promise<DetectedWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.uuid) evmProviders.set(detail.info.uuid, detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // announcements are immediate; a tick is enough to collect them all
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);

      /*
        Fall back to the legacy injected provider when nothing announced —
        older wallets predate the standard and would otherwise be invisible.
      */
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (evmProviders.size === 0 && legacy) {
        evmProviders.set("injected", {
          info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" },
          provider: legacy,
        });
      }

      resolve(
        [...evmProviders.values()].map((d) => ({
          id: d.info.uuid,
          name: d.info.name,
          icon: d.info.icon,
          vm: "evm" as const,
        })),
      );
    }, 120);
  });
}

/* ── Solana, via the Wallet Standard registry ──────────────────── */

type StandardWallet = {
  name: string;
  icon: string;
  accounts: readonly { address: string; publicKey: Uint8Array }[];
  features: Record<string, unknown>;
};

const solWallets = new Map<string, StandardWallet>();

async function discoverSolana(): Promise<DetectedWallet[]> {
  if (typeof window === "undefined") return [];
  try {
    const { getWallets } = await import("@wallet-standard/app");
    const registered = getWallets().get();
    for (const w of registered) {
      const wallet = w as unknown as StandardWallet;
      // only wallets that can both connect and sign a message are useful here
      const canConnect = "standard:connect" in wallet.features;
      const canSign = "solana:signMessage" in wallet.features;
      if (canConnect && canSign) solWallets.set(wallet.name, wallet);
    }
    return [...solWallets.values()].map((w) => ({
      id: w.name,
      name: w.name,
      icon: w.icon,
      vm: "svm" as const,
    }));
  } catch {
    return [];
  }
}

/* Everything installed in this browser that can prove ownership. */
export async function detectWallets(): Promise<DetectedWallet[]> {
  const [evm, sol] = await Promise.all([discoverEvm(), discoverSolana()]);
  return [...sol, ...evm];
}

/* ── connect and sign ──────────────────────────────────────────── */

function ownershipMessage(address: string, purpose: "dev" | "link"): string {
  return purpose === "dev"
    ? `Quant AI: dev wallet ${address} · ${new Date().toISOString()}`
    : `Quant AI: link wallet ${address} to my account · ${new Date().toISOString()}`;
}

export async function connectAndProve(
  wallet: DetectedWallet,
  purpose: "dev" | "link" = "dev",
): Promise<SignedProof> {
  if (wallet.vm === "svm") {
    const w = solWallets.get(wallet.id);
    if (!w) throw new Error("That wallet is no longer available.");

    const connect = w.features["standard:connect"] as {
      connect: () => Promise<{ accounts: readonly { address: string; publicKey: Uint8Array }[] }>;
    };
    const result = await connect.connect();

    /*
      Take the account from the wallet itself after connecting.

      Wallets differ on what `connect()` returns — some hand back the accounts,
      some return nothing useful and expect you to read `wallet.accounts`. The
      signing feature wants the wallet's own account object, so preferring that
      avoids passing it a copy it doesn't recognise.
    */
    const account = w.accounts[0] ?? result?.accounts?.[0];
    if (!account) throw new Error("The wallet didn't share an account.");

    // base58, exactly as the wallet reports it — never lowercased
    const address = account.address;
    const message = ownershipMessage(address, purpose);

    const signer = w.features["solana:signMessage"] as {
      signMessage: (input: {
        account: unknown;
        message: Uint8Array;
      }) => Promise<readonly { signature?: Uint8Array; signedMessage?: Uint8Array }[]>;
    };
    const signed = await signer.signMessage({
      account,
      message: new TextEncoder().encode(message),
    });

    // the result is an array of outputs, one per message signed
    const raw = signed?.[0]?.signature;
    if (!raw) throw new Error("The wallet returned no signature.");

    const { default: bs58 } = await import("bs58");
    return { address, message, signature: bs58.encode(raw), chain: "SOL" };
  }

  const detail = evmProviders.get(wallet.id);
  if (!detail) throw new Error("That wallet is no longer available.");

  const accounts = (await detail.provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const address = String(accounts?.[0] ?? "").toLowerCase();
  if (!address) throw new Error("No account was shared.");

  const message = ownershipMessage(address, purpose);
  const signature = (await detail.provider.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;

  return { address, message, signature, chain: "ETH" };
}
