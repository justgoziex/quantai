"use client";

import { createContext, useContext } from "react";

/*
  App-level auth state, decoupled from the wallet SDK.
  When NEXT_PUBLIC_PRIVY_APP_ID is unset the app runs in "unconfigured" mode:
  everything renders, auth surfaces explain what's missing. AuthBridge (rendered
  inside PrivyProvider) feeds real values in once the SDK is configured.
*/
export type AuthState = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  walletAddress: string | null;
  /* The Solana account wallet (base58). Never interchangeable with the EVM one. */
  solanaAddress: string | null;
  logout: () => Promise<void> | void;
  /* Opens Privy's secure export dialog for a wallet (defaults to primary). */
  exportWallet: (address?: string) => Promise<void> | void;
  /* Remove a wallet from the account (embedded or connected). */
  unlinkWallet: (address: string) => Promise<void>;
  /* Access token for calling our API. Null when signed out/unconfigured. */
  getToken: () => Promise<string | null>;
  /*
    Connect an EXTERNAL wallet (MetaMask, mobile wallet, etc.) via Privy and
    sign an ownership message. Returns the signed payload to POST, or null if
    unavailable/cancelled. Distinct from the embedded wallet.
  */
  linkExternalWallet: (purpose?: "link" | "dev") => Promise<{
    address: string;
    message: string;
    signature: string;
    chain: string;
  } | null>;
  /* Sign the ownership message with a wallet that is already connected. */
  signOwnership: (
    address: string,
    purpose?: "link" | "dev",
  ) => Promise<{ address: string; message: string; signature: string; chain: string } | null>;
  /* All wallets on the account — embedded + connected/imported. */
  wallets: { address: string; type: string }[];
  /* Open Privy's wallet login (Sign-In With Ethereum). */
  loginWithWallet: () => void;
  /* Provision an additional embedded wallet. Returns its address. */
  createEmbeddedWallet: () => Promise<string | null>;
  /* Import an existing EVM wallet by private key. Returns its address. */
  importWallet: (privateKey: string) => Promise<string | null>;
  /* Sign a message with a NAMED embedded wallet, not just the first one. */
  signWithEmbedded: (address: string, message: string) => Promise<string | null>;
};

export const UNCONFIGURED: AuthState = {
  configured: false,
  ready: true,
  authenticated: false,
  email: null,
  walletAddress: null,
  solanaAddress: null,
  logout: () => {},
  exportWallet: () => {},
  unlinkWallet: async () => {},
  getToken: async () => null,
  linkExternalWallet: async () => null,
  signOwnership: async () => null,
  wallets: [],
  loginWithWallet: () => {},
  createEmbeddedWallet: async () => null,
  importWallet: async () => null,
  signWithEmbedded: async () => null,
};

export const AuthContext = createContext<AuthState>(UNCONFIGURED);

export function useAuth() {
  return useContext(AuthContext);
}

export function shortAddress(addr: string | null): string {
  if (!addr) return "—";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}
