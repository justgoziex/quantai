"use client";

import { useCallback, useEffect, useRef } from "react";
import { MotionConfig } from "framer-motion";
import {
  PrivyProvider,
  usePrivy,
  useWallets,
  useExportWallet,
  useConnectWallet,
  useLogin,
  useSignMessage,
  useCreateWallet,
  useImportWallet,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignMessage as useSolanaSignMessage,
  useCreateWallet as useSolanaCreateWallet,
  toSolanaWalletConnectors,
} from "@privy-io/react-auth/solana";
import { mainnet, bsc } from "viem/chains";
import { robinhoodChain } from "@/lib/dex";
import { AuthContext, UNCONFIGURED } from "@/components/auth/auth-context";
import { I18nProvider, type Locale } from "@/lib/i18n";
import { CurrencyProvider } from "@/lib/currency";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/*
  Solana wallet connectors, created once.

  This registers listeners for wallets announcing themselves to the page. Built
  inside the config object it was a new plugin on every render, so those
  listeners were torn down and re-added constantly and detection never settled
  — leaving Privy with an empty wallet list and nothing to offer but the
  extension download page.
*/
const SOLANA_CONNECTORS = toSolanaWalletConnectors();
// Our own WalletConnect Cloud (Reown) project id — required for external
// wallet connect to work on MOBILE (QR + deep links). Without it Privy falls
// back to a shared id that doesn't reliably reach mobile wallets.
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/* Capture ?ref=CODE from any landing URL so sign-up can attribute it. */
function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Z0-9]{4,12}$/i.test(ref)) {
        localStorage.setItem("quantai:ref", ref.toUpperCase());
      }
    } catch {
      /* no-op */
    }
  }, []);
  return null;
}

/* Coarse device fingerprint — an anti-abuse layer, not identification. */
function deviceFingerprint(): string {
  try {
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height + "@" + screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency ?? 0,
    ].join("|");
    let h = 0x9e3779b9;
    for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 0x01000193) >>> 0;
    return "fp_" + h.toString(16);
  } catch {
    return "fp_unknown";
  }
}

/*
  Reads Privy state and republishes it as app-level AuthState.
  Embedded wallets are created asynchronously AFTER login — `user.wallet`
  alone can lag, so we watch useWallets() (reactive) and, as a belt-and-braces
  fallback, explicitly call createWallet() once if login finished without one.
*/
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, logout, createWallet, getAccessToken, unlinkWallet } =
    usePrivy();
  const { wallets } = useWallets();
  const { exportWallet } = useExportWallet();

  const exportWalletByAddress = useCallback(
    (address?: string) => exportWallet(address ? { address } : undefined),
    [exportWallet],
  );
  /*
    Detach a wallet from the account.

    Errors are allowed to surface. Swallowing them meant a disconnect that
    Privy refused looked identical to one that worked — the wallet stayed, and
    nothing said why.
  */
  const unlinkWalletByAddress = useCallback(
    async (address: string) => {
      await unlinkWallet(address);
    },
    [unlinkWallet],
  );
  const { signMessage: signEmbedded } = useSignMessage();
  const { wallets: solWallets } = useSolanaWallets();
  const { signMessage: solSignMessage } = useSolanaSignMessage();
  const { createWallet: createSolWallet } = useSolanaCreateWallet();
  const attemptedCreate = useRef(false);
  const attemptedSolCreate = useRef(false);
  /* the poll above reads these, so they must track the latest render */
  const walletsRef = useRef(wallets);
  const solWalletsRef = useRef(solWallets);
  walletsRef.current = wallets;
  solWalletsRef.current = solWallets;
  const synced = useRef(false);

  // Promise-bridge for Privy's callback-based external-wallet connect flow.
  const connectPending = useRef<{
    resolve: (w: ConnectedWallet) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const { connectWallet } = useConnectWallet({
    onSuccess: ({ wallet }) => {
      connectPending.current?.resolve(wallet as ConnectedWallet);
      connectPending.current = null;
    },
    onError: (err) => {
      connectPending.current?.reject(new Error(String(err)));
      connectPending.current = null;
    },
  });

  /*
    Prove ownership of a wallet that is ALREADY connected.

    The modal flow waits for a new address to join the wallet list — correct
    for a first connection, and a deadlock for a wallet that's already there:
    nothing new ever appears, so it waits until the timeout while the user
    stares at a site that seems to ignore them. A connected wallet needs no
    modal at all; it can simply sign.
  */
  const signOwnership = useCallback(
    async (address: string, purpose: "link" | "dev" = "dev") => {
      const sol = solWalletsRef.current.find((w) => w.address === address);
      if (sol) {
        const message =
          purpose === "dev"
            ? `Quant AI: dev wallet ${address} · ${new Date().toISOString()}`
            : `Quant AI: link wallet ${address} to my account · ${new Date().toISOString()}`;
        const { signature } = await solSignMessage({
          message: new TextEncoder().encode(message),
          wallet: sol,
        });
        const { default: bs58 } = await import("bs58");
        return { address, message, signature: bs58.encode(signature), chain: "SOL" };
      }

      const evm = walletsRef.current.find(
        (w) => w.address.toLowerCase() === address.toLowerCase(),
      );
      if (!evm) return null;
      const lower = evm.address.toLowerCase();
      const message =
        purpose === "dev"
          ? `Quant AI: dev wallet ${lower} · ${new Date().toISOString()}`
          : `Quant AI: link wallet ${lower} to my account · ${new Date().toISOString()}`;
      const provider = await evm.getEthereumProvider();
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, lower],
      })) as string;
      return { address: lower, message, signature, chain: "ETH" };
    },
    [solSignMessage],
  );

  const linkExternalWallet = useCallback(async (purpose: "link" | "dev" = "link") => {
    /*
      Wait for a wallet from either family.

      The connect callback belongs to the EVM hook, so a Solana wallet could
      complete in the wallet app and never resolve here — the site sat waiting
      while the user had already approved. Closing the modal did the same. So
      the callback is one way this settles, and noticing a new address in
      either list is another, with a ceiling so it can never hang.
    */
    const before = new Set([
      ...walletsRef.current.map((w) => w.address),
      ...solWalletsRef.current.map((w) => w.address),
    ]);

    const wallet = await new Promise<ConnectedWallet>((resolve, reject) => {
      connectPending.current = { resolve, reject };
      let settled = false;
      const finish = (w: ConnectedWallet) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(ceiling);
        connectPending.current = null;
        resolve(w);
      };

      // whichever list gains an address, that's the wallet they chose
      const poll = setInterval(() => {
        const fresh =
          walletsRef.current.find((w) => !before.has(w.address)) ??
          solWalletsRef.current.find((w) => !before.has(w.address));
        if (fresh) finish(fresh as unknown as ConnectedWallet);
      }, 400);

      const ceiling = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        connectPending.current = null;
        reject(new Error("Wallet connection timed out."));
      }, 180_000);

      connectPending.current = {
        resolve: (w) => finish(w),
        reject: (e) => {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          clearTimeout(ceiling);
          connectPending.current = null;
          reject(e);
        },
      };

      try {
        /*
          Connect, never link.

          Linking permanently attaches a wallet to the account, and Privy
          restores every linked wallet on each page load — so proving ownership
          of one deployer left it silently reconnecting forever, and the user
          had no way to detach it. Connecting lasts the session and leaves the
          account alone, which is all a signature needs.
        */
        connectWallet();
      } catch (e) {
        connectPending.current?.reject(e as Error);
      }
    });

    /*
      The modal offers Solana wallets alongside EVM ones, so which chain the
      user picked is only known now. Solana addresses are base58 and carry
      case — lowercasing one, as the EVM path does, produces an address that
      matches nothing and silently fails verification later.
    */
    /*
      Read the live list, not the one captured when this callback was made. A
      wallet that connected seconds ago isn't in the stale closure, so it would
      be treated as EVM — and lowercasing a base58 address produces one that
      verifies against nothing.
    */
    const solWallet = solWalletsRef.current.find((w) => w.address === wallet.address);
    const address = solWallet ? wallet.address : wallet.address.toLowerCase();
    const message =
      purpose === "dev"
        ? `Quant AI: dev wallet ${address} · ${new Date().toISOString()}`
        : `Quant AI: link wallet ${address} to my account · ${new Date().toISOString()}`;

    // one prompt either way, and never a mismatched message/signature pair
    if (solWallet) {
      const { signature } = await solSignMessage({
        message: new TextEncoder().encode(message),
        wallet: solWallet,
      });
      const { default: bs58 } = await import("bs58");
      return { address, message, signature: bs58.encode(signature), chain: "SOL" };
    }

    const provider = await wallet.getEthereumProvider();
    const signature = (await provider.request({
      method: "personal_sign",
      params: [message, address],
    })) as string;
    return { address, message, signature, chain: "ETH" };
  }, [connectWallet, solSignMessage]);

  // wallet management
  const { login } = useLogin();
  const { createWallet: createExtraWallet } = useCreateWallet();
  const { importWallet } = useImportWallet();

  const loginWithWallet = useCallback(() => {
    try {
      login({ loginMethods: ["wallet"] });
    } catch {
      login();
    }
  }, [login]);

  const createEmbeddedWallet = useCallback(async () => {
    try {
      const w = await createExtraWallet({ createAdditional: true });
      return w?.address ?? null;
    } catch {
      return null;
    }
  }, [createExtraWallet]);

  /*
    Sign with a specific embedded wallet — the one just imported, rather than
    whichever happens to be first. A developer usually has an account wallet
    already, so without naming the address the signature would come from the
    wrong one and prove ownership of a wallet that deployed nothing.
  */
  const signWithEmbedded = useCallback(
    async (address: string, message: string) => {
      try {
        // the address is an option, not part of the message payload
        const { signature } = await signEmbedded({ message }, { address });
        return signature ?? null;
      } catch {
        return null;
      }
    },
    [signEmbedded],
  );

  const importWalletKey = useCallback(
    async (privateKey: string) => {
      const pk = privateKey.trim();
      const hex = pk.startsWith("0x") ? pk : `0x${pk}`;
      const w = await importWallet({ privateKey: hex });
      return w?.address ?? null;
    },
    [importWallet],
  );

  const walletList = [
    ...wallets.map((w) => ({ address: w.address, type: w.walletClientType })),
    ...solWallets.map((w) => ({ address: w.address, type: w.standardWallet?.name ?? "solana" })),
  ];

  // the Solana account wallet, kept separate — the two address formats are
  // not interchangeable and must never be substituted for one another
  const solanaAddress =
    solWallets.find((w) => /privy/i.test(w.standardWallet?.name ?? ""))?.address ??
    solWallets[0]?.address ??
    null;

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const walletAddress = embedded?.address ?? user?.wallet?.address ?? null;
  const email = user?.email?.address ?? user?.google?.email ?? null;

  useEffect(() => {
    if (ready && authenticated && !walletAddress && !attemptedCreate.current) {
      attemptedCreate.current = true;
      // No-op if a wallet already exists or auto-create is in flight.
      createWallet().catch(() => {});
    }
    /*
      Accounts created before Solana existed here have no Solana wallet, and
      createOnLogin only covers the login that follows. This gives every
      existing user one the moment they next open the site, so nobody has to
      do anything to be able to trade Solana.
    */
    if (ready && authenticated && solWallets.length === 0 && !attemptedSolCreate.current) {
      attemptedSolCreate.current = true;
      createSolWallet().catch(() => {});
    }
    if (!authenticated) {
      attemptedCreate.current = false;
      attemptedSolCreate.current = false;
      synced.current = false;
    }
  }, [ready, authenticated, walletAddress, createWallet, solWallets.length, createSolWallet]);

  // Sync identity + wallet to our database once per session.
  useEffect(() => {
    if (!ready || !authenticated || !walletAddress || synced.current) return;
    synced.current = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            email,
            walletAddress,
            solanaAddress: solanaAddress ?? undefined,
            referralCode: localStorage.getItem("quantai:ref") ?? undefined,
            deviceFingerprint: deviceFingerprint(),
          }),
        });
      } catch {
        synced.current = false; // retry next render cycle
      }
    })();
  }, [ready, authenticated, walletAddress, solanaAddress, email, getAccessToken]);

  return (
    <AuthContext.Provider
      value={{
        configured: true,
        ready,
        authenticated,
        email,
        walletAddress,
        solanaAddress,
        logout,
        exportWallet: exportWalletByAddress,
        unlinkWallet: unlinkWalletByAddress,
        getToken: getAccessToken,
        linkExternalWallet,
        signOwnership,
        wallets: walletList,
        loginWithWallet,
        createEmbeddedWallet,
        importWallet: importWalletKey,
        signWithEmbedded,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function Providers({ children, locale = "en" }: { children: React.ReactNode; locale?: Locale }) {
  if (!PRIVY_APP_ID) {
    return (
      <I18nProvider initialLocale={locale}>
        <CurrencyProvider>
          <AuthContext.Provider value={UNCONFIGURED}>
            <MotionConfig reducedMotion="user">
              <RefCapture />
              {children}
            </MotionConfig>
          </AuthContext.Provider>
        </CurrencyProvider>
      </I18nProvider>
    );
  }
  return (
    <I18nProvider initialLocale={locale}>
    <CurrencyProvider>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // email/google create embedded wallets; "wallet" also lets users
        // connect external trading wallets (MetaMask, mobile, etc.)
        loginMethods: ["email", "google", "wallet"],
        // our WalletConnect Cloud project id → mobile wallet connect works
        ...(WALLETCONNECT_PROJECT_ID
          ? { walletConnectCloudProjectId: WALLETCONNECT_PROJECT_ID }
          : {}),
        // registered once at module scope — see the note there
        externalWallets: { solana: { connectors: SOLANA_CONNECTORS } },
        // chains the embedded wallet can transact on (incl. Robinhood L2)
        supportedChains: [mainnet, bsc, robinhoodChain],
        defaultChain: mainnet,
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          // every account gets a Solana wallet too, so a signed-in user can
          // trade Solana without connecting anything extra
          solana: { createOnLogin: "users-without-wallets" },
          // The account wallet signs directly once the user is signed in —
          // no per-transaction confirmation step. This is a single flag, not a
          // per-chain one, so it governs Solana as well as the EVM chains.
          showWalletUIs: false,
        },
        appearance: {
          theme: "dark",
          accentColor: "#EEA02B",
          logo: "/brand/quantai-lockup.svg",
          // Phantom, Solflare and the rest appear in the connect modal
          // beside the EVM wallets, WalletConnect included
          walletChainType: "ethereum-and-solana",
        },
      }}
    >
      <AuthBridge>
        <MotionConfig reducedMotion="user">
          <RefCapture />
          {children}
        </MotionConfig>
      </AuthBridge>
    </PrivyProvider>
    </CurrencyProvider>
    </I18nProvider>
  );
}
