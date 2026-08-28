import { createAppKit } from "@reown/appkit/react";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { solana, mainnet, bsc, base } from "@reown/appkit/networks";

/*
  Reown AppKit — the wallet connector for proving ownership of a deployer
  wallet.

  Built rather than hand-rolled because the hard parts are the ones a hand-
  rolled connector silently omits: QR pairing, mobile deep links back into the
  wallet app, session restore, and the long tail of wallets that each announce
  themselves slightly differently. Detecting browser extensions is the easy
  ten percent.

  Deliberately separate from account sign-in. Proving control of a deployer is
  a one-off signature, not a claim about identity — the two were entangled
  before, which is why connecting a deployer wallet altered the account and
  failed outright for any wallet already attached to it.
*/

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const reownConfigured = (): boolean => PROJECT_ID.length > 0;

let modal: ReturnType<typeof createAppKit> | null = null;

/*
  One instance for the page. AppKit registers listeners and a session on
  creation, so building it per render would tear those down repeatedly — the
  same mistake that left the previous connector unable to see any wallet.
*/
export function getWalletModal() {
  if (!PROJECT_ID) return null;
  if (modal) return modal;

  /*
    Never let a wallet library take the page down.

    Everything else on the developer portal works without a wallet connected —
    listing, cashback, imported keys — so a connector that fails to initialise
    should cost the connect button, not the page.
  */
  try {
    modal = build();
  } catch {
    modal = null;
  }
  return modal;
}

function build() {
  return createAppKit({
    adapters: [new SolanaAdapter()],
    networks: [solana, mainnet, bsc, base],
    defaultNetwork: solana,
    projectId: PROJECT_ID,
    metadata: {
      name: "Quant AI",
      description: "Memecoin screening and token launching",
      url: "https://www.quantniumai.com",
      icons: ["https://www.quantniumai.com/brand/quantai-mark.svg"],
    },
    features: {
      // this modal exists to connect a wallet, not to sign people in
      email: false,
      socials: false,
      analytics: false,
    },
  });
}
