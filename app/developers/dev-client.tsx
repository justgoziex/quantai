"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallets } from "@privy-io/react-auth";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/product/empty-state";
import { ChainLogo } from "@/components/brand/chain-logo";
import { CreatorCashback } from "@/components/developers/creator-cashback";
import { LiquidityPartner } from "@/components/developers/liquidity-partner";
import { WalletPicker } from "@/components/developers/wallet-picker";
import {
  useWallets as useSolanaWallets,
  useSignAndSendTransaction as useSolanaSignAndSend,
} from "@privy-io/react-auth/solana";
import { usdCompact } from "@/lib/format";
import { planFeePayment, executeFeePayment, type Holding } from "@/lib/fee-autopay";
import { supportsBatch, sendCallsBatch } from "@/lib/wallet-batch";
import type { ChainId } from "@/lib/chains";
import { cn } from "@/lib/utils";

/*
  Developer portal — connect the wallet you deployed from, see every token it
  created, and list the ones Quant AI doesn't cover yet (paid), or buy a
  promoted ad slot for one.
*/
type Profile = {
  id: string;
  wallet: string;
  verified: boolean;
  createdAt: string;
  /* which virtual machine this wallet belongs to, and whether we hold its key */
  vm: "evm" | "svm";
  imported: boolean;
};
type DevToken = {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  listed: boolean;
  liquidityUsd?: number;
  score?: number;
  listingStatus: string | null;
};

const CHAINS = [
  { v: "eth", label: "Ethereum" },
  { v: "bsc", label: "BNB Chain" },
  { v: "base", label: "Base" },
  { v: "rh", label: "Robinhood" },
  { v: "sol", label: "Solana" },
] as const;

export function DevClient() {
  const { ready, authenticated, getToken, linkExternalWallet, signOwnership } = useAuth();
  const { wallets: solWallets } = useSolanaWallets();
  const { signAndSendTransaction: solSignAndSend } = useSolanaSignAndSend();
  const { wallets } = useWallets();
  const { t } = useI18n();

  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [active, setActive] = useState<string>("");
  const [chain, setChain] = useState<(typeof CHAINS)[number]["v"]>("eth");
  const [tokens, setTokens] = useState<DevToken[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [fee, setFee] = useState({ eth: 0, wallet: "" });
  const [showImport, setShowImport] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* which chain families already have a deployer wallet on this account */
  const [coverage, setCoverage] = useState({ evm: false, sol: false });
  const [importKey, setImportKey] = useState("");
  /*
    The fee is quoted in whatever the chain settles in — a Solana listing costs
    SOL, and showing it in ETH would be a different number and a different
    asset.
  */
  const feeUnit = chain === "sol" ? "SOL" : chain === "bsc" ? "BNB" : "ETH";
  const feeLabel = `${fee.eth} ${feeUnit}`;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const authed = useCallback(async () => ({ authorization: `Bearer ${await getToken()}` }), [getToken]);

  /*
    Parse a response defensively. A crashed/timed-out function can return an
    empty body, and calling .json() on that throws a cryptic browser message
    ("the data couldn't be read…") — surface the real status instead.
  */
  const readJson = async (r: Response): Promise<Record<string, unknown>> => {
    const text = await r.text().catch(() => "");
    if (!text.trim()) {
      if (r.ok) return {};
      throw new Error(
        r.status === 504 || r.status === 408
          ? t("The server took too long — your payment is safe; try listing again.")
          : `${t("Request failed")} (${r.status})`,
      );
    }
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${t("Unexpected response from the server")} (${r.status})`);
    }
  };

  const loadProfiles = useCallback(async () => {
    try {
      const r = await fetch("/api/dev/wallet", { headers: await authed() });
      if (!r.ok) return;
      const d = await r.json();
      setProfiles(d.profiles ?? []);
      setCoverage({ evm: Boolean(d.hasEvm), sol: Boolean(d.hasSol) });
      if (!active && d.profiles?.[0]) setActive(d.profiles[0].id);
    } catch {
      /* retry on next visit */
    }
  }, [authed, active]);

  useEffect(() => {
    if (ready && authenticated) loadProfiles();
  }, [ready, authenticated, loadProfiles]);

  const loadTokens = useCallback(async () => {
    if (!active) return;
    setTokens(null);
    try {
      const r = await fetch(`/api/dev/tokens?profileId=${active}&chain=${chain}`, { headers: await authed() });
      const d = await r.json();
      setTokens(d.tokens ?? []);
      setSupported(d.supported !== false);
      setFee({ eth: d.feeEth ?? 0, wallet: d.feeWallet ?? "" });
    } catch {
      setTokens([]);
    }
  }, [active, chain, authed]);

  useEffect(() => {
    if (active) loadTokens();
  }, [active, chain, loadTokens]);

  /*
    Verify a wallet that's already connected.

    The modal flow only completes for a wallet joining the list for the first
    time — for one that's already connected nothing new appears, so it waited
    forever. A connected wallet doesn't need the modal: it signs directly.
  */
  const verifyConnected = async (address: string) => {
    setMsg(null);
    setBusy(`verify:${address}`);
    try {
      const payload = await signOwnership(address, "dev");
      if (!payload) throw new Error(t("That wallet isn't connected any more."));
      const r = await fetch("/api/dev/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authed()) },
        body: JSON.stringify(payload),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) ?? t("Couldn't verify that wallet."));
      setMsg({ kind: "ok", text: t("Developer wallet verified.") });
      await loadProfiles();
      const profile = d.profile as { id?: string } | undefined;
      if (profile?.id) setActive(profile.id);
    } catch (e) {
      const m = (e as Error).message ?? "";
      setMsg({ kind: "err", text: /reject|denied|cancel/i.test(m) ? t("Signature cancelled.") : m });
    } finally {
      setBusy(null);
    }
  };


  /* connect + prove ownership of a deployer wallet */
  /*
    Record a signed proof of ownership.

    The signature comes from the wallet through Reown; this only carries it to
    the server. Nothing here touches the account — a deployer wallet is proven,
    not adopted.
  */
  const submitProof = async (proof: {
    address: string;
    message: string;
    signature: string;
    chain: string;
  }) => {
    setMsg(null);
    setBusy("connect");
    try {
      const r = await fetch("/api/dev/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authed()) },
        body: JSON.stringify(proof),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) ?? t("Couldn't verify that wallet."));
      setMsg({ kind: "ok", text: t("Developer wallet verified.") });
      await loadProfiles();
      const profile = d.profile as { id?: string } | undefined;
      if (profile?.id) setActive(profile.id);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

 
  const importDev = async () => {
    const key = importKey.trim();
    if (!key) return;
    setMsg(null);
    setBusy("import");
    try {
      const r = await fetch("/api/dev/import", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authed()) },
        body: JSON.stringify({ privateKey: key }),
      });
      const d = await readJson(r);
      if (!r.ok) throw new Error((d.error as string) ?? t("Couldn't import that wallet."));

      // clear it from component state the moment it's no longer needed
      setImportKey("");
      setShowImport(false);
      setMsg({ kind: "ok", text: t("Developer wallet imported.") });
      await loadProfiles();
      const profile = d.profile as { id?: string } | undefined;
      if (profile?.id) setActive(profile.id);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message || t("Couldn't import that wallet.") });
    } finally {
      setBusy(null);
    }
  };

  /*
    List a token. The SERVER decides whether a fee is due (tokens Quant AI
    already indexes are free) — it answers 402 when payment is required, so we
    only ever prompt a wallet when it's genuinely needed. It also confirms the
    payment on-chain, so the browser never talks to a chain RPC.
  */
  const listToken = async (address: string) => {
    setMsg(null);
    setBusy(address);

    const submit = async (feeTxHash?: string) => {
      const r = await fetch("/api/dev/listing", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authed()) },
        body: JSON.stringify({ profileId: active, chain, tokenAddress: address, feeTxHash }),
      });
      return { r, d: await readJson(r) };
    };

    const succeed = async () => {
      setMsg({ kind: "ok", text: t("Listed — your token is live on the screener.") });
      setManual("");
      await loadTokens();
    };

    try {
      setStep(t("Checking your token…"));
      let { r, d } = await submit();

      // free listing (already indexed) — done in one shot
      if (r.ok) return await succeed();

      if (r.status === 402) {
        /*
          Solana settles the fee in a single transfer — no allowance to grant,
          no router, nothing to batch — so it's one transaction and one
          confirmation rather than the EVM path's multi-step plan.
        */
        if (chain === "sol") {
          /*
            Pay from the wallet doing the listing.

            Taking the first Solana wallet meant the embedded account wallet
            was asked to pay — it holds nothing, so a developer with a funded
            Phantom wallet was told they had no balance. The deployer being
            listed under is the one that should pay.
          */
          const devWallet = profiles?.find((x) => x.id === active)?.wallet;
          const w =
            solWallets.find((x) => x.address === devWallet) ??
            solWallets.find((x) => !/privy/i.test(x.standardWallet?.name ?? "")) ??
            solWallets[0];
          if (!w) throw new Error(t("Connect a Solana wallet to pay the fee."));
          setStep(t("Preparing the payment…"));
          const fres = await fetch("/api/solana/fee-tx", {
            method: "POST",
            headers: { ...(await authed()), "content-type": "application/json" },
            body: JSON.stringify({ owner: w.address }),
          });
          const fd = await readJson(fres);
          if (!fres.ok) throw new Error(t(String(fd.error ?? "Couldn't prepare the payment.")));

          setStep(t("Confirm in your wallet…"));
          const raw = Uint8Array.from(atob(String(fd.transaction)), (c) => c.charCodeAt(0));
          const { signature } = await solSignAndSend({
            transaction: raw,
            wallet: w,
            options: { uiOptions: { showWalletUIs: false } },
          });
          const { default: bs58 } = await import("bs58");
          const feeSig = bs58.encode(signature);

          setStep(t("Waiting for the payment to confirm…"));
          for (let attempt = 0; ; attempt++) {
            ({ r, d } = await submit(feeSig));
            if (r.ok) return await succeed();
            if (attempt >= 10) throw new Error(t(String(d.error ?? "Payment didn't confirm.")));
            await new Promise((res) => setTimeout(res, 3_000));
          }
        }

        const due = Number(d.feeEth ?? fee.eth) || 0;
        if (!/^0x[0-9a-fA-F]{40}$/.test(fee.wallet)) {
          throw new Error(t("Listing payments aren't set up yet — contact the desk."));
        }
        const w = wallets[0];
        if (!w) throw new Error(t("Connect a wallet to pay the fee."));
        const target = chain === "bsc" ? 56 : chain === "base" ? 8453 : chain === "rh" ? 4663 : 1;
        setStep(t("Switching network…"));
        try {
          await w.switchChain(target);
        } catch {
          throw new Error(t("Add this network to your wallet first, then try again."));
        }
        const provider = await w.getEthereumProvider();
        const send = async (tx: { to: string; data?: string; value?: string }) =>
          (await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: w.address, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" }],
          })) as `0x${string}`;

        /*
          Pay with whatever the wallet holds: native if it covers the fee,
          otherwise sell just enough of a token for it. The desk is always
          credited in the native token.
        */
        setStep(t("Checking your balances…"));
        const hres = await fetch(`/api/fees/holdings?chain=${chain}&include=${address}&owner=${w.address}`, {
          headers: await authed(),
        });
        const h = await readJson(hres);
        const plan = await planFeePayment({
          chain: chain as ChainId,
          owner: w.address as `0x${string}`,
          feeNative: due,
          nativeBalance: Number(h.nativeBalance ?? 0),
          holdings: (h.holdings as Holding[]) ?? [],
          tolerancePct: Number(h.feeTolerancePct ?? 0),
        });
        if (plan.kind === "none") throw new Error(plan.shortfall);
        /*
          One confirmation for approve + swap + pay where the wallet supports
          batched calls; otherwise each step is signed separately.
        */
        const canBatch = await supportsBatch(provider, target);
        const feeTxHash = await executeFeePayment({
          chain: chain as ChainId,
          owner: w.address as `0x${string}`,
          feeWallet: fee.wallet as `0x${string}`,
          plan,
          send,
          sendBatch: canBatch ? (calls) => sendCallsBatch(provider, w.address, target, calls) : undefined,
          onStep: (label) => setStep(t(label)),
        });

        setStep(t("Waiting for the payment to confirm…"));
        for (let attempt = 0; ; attempt++) {
          ({ r, d } = await submit(feeTxHash));
          if (r.ok) return await succeed();
          const pending = r.status === 202 || d.pending === true;
          if (!pending) throw new Error((d.error as string) ?? t("Listing failed."));
          if (attempt >= 24) {
            throw new Error(t("Still confirming — reopen this page shortly; you won't be charged again."));
          }
          await new Promise((res) => setTimeout(res, 5000));
        }
      }

      throw new Error((d.error as string) ?? t("Listing failed."));
    } catch (e) {
      let m = (e as Error).message ?? "";
      if (/reject|denied|user denied/i.test(m)) m = t("Payment cancelled.");
      // never surface a raw browser/RPC parse error to the user
      else if (/couldn't be read|is missing|unexpected end|not valid json|load failed|failed to fetch/i.test(m)) {
        m = t("Network hiccup — nothing was lost. Try again.");
      }
      setMsg({ kind: "err", text: m.slice(0, 180) });
    } finally {
      setStep(null);
      setBusy(null);
    }
  };

  /* status line shown next to whatever the user just clicked */
  const statusLine = step ? (
    <p className="flex items-center gap-2 text-sm text-amber">
      <span className="h-1.5 w-1.5 rounded-full bg-amber motion-safe:animate-live-pulse" aria-hidden="true" />
      {step}
    </p>
  ) : msg ? (
    <p className={cn("text-sm", msg.kind === "ok" ? "text-gain" : "text-loss")}>{msg.text}</p>
  ) : null;

  if (!ready) return <Skeleton className="h-64 rounded-md" />;

  if (!authenticated) {
    return (
      <EmptyState
        label={t("Developers")}
        title={t("Sign in to open the dev portal")}
        description={t("Connect your deployer wallet.")}
        action={
          <Button asChild>
            <Link href="/signin">{t("Sign in")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* wallets */}
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="text-label">{t("Your developer wallets")}</span>
          <span className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPickerOpen(true)}
              disabled={busy === "connect"}
            >
              {busy === "connect" ? t("Verifying…") : t("Connect deployer wallet")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowImport((v) => !v)}
              disabled={busy !== null}
            >
              {t("Import private key")}
            </Button>
          </span>
        </div>
        {showImport ? (
          <div className="flex flex-col gap-2 border-b border-line bg-raised px-4 py-4">
            <p className="text-sm text-bone">{t("Import a deployer wallet")}</p>
            <p className="text-xs text-muted">
              {t(
                "For a deployer that lives in a script rather than a browser wallet. Works for EVM and Solana.",
              )}
            </p>
            <Input
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              placeholder={t("EVM private key, or Solana secret")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-data-sm"
            />
            <span className="flex gap-2">
              <Button size="sm" onClick={importDev} disabled={busy === "import" || !importKey.trim()}>
                {busy === "import" ? t("Verifying…") : t("Import and verify")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowImport(false);
                  setImportKey("");
                }}
              >
                {t("Cancel")}
              </Button>
            </span>
          </div>
        ) : null}
        {profiles === null ? (
          <Skeleton className="m-4 h-14" />
        ) : profiles.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {t("Sign to prove ownership. No gas.")}
          </p>
        ) : (
          profiles.map((p) => (
            /*
              The row selects; the × clears it from view. They're siblings
              rather than nested, because a button inside a button is invalid
              markup and the inner click would fight the outer one.
            */
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-3 border-b border-line px-4 py-3 transition-colors last:border-0 hover:bg-raised",
                active === p.id && "bg-raised",
              )}
            >
              <button onClick={() => setActive(p.id)} className="flex flex-1 items-center gap-3 text-left">
                <span className="font-mono text-data-sm text-bone">{shortAddress(p.wallet)}</span>
                <Badge variant="gain">{t("Verified")}</Badge>
                {active === p.id ? (
                  <span className="ml-auto font-mono text-data-sm text-amber">{t("Active")}</span>
                ) : null}
              </button>
            </div>
          ))
        )}

        {/*
          Ask for the side that's missing.

          A developer who has proved a Solana deployer has no use for another
          Solana prompt — what they haven't done is add their EVM deployer, and
          vice versa. Naming the specific chains is the difference between an
          invitation and a generic button.
        */}
        {profiles && profiles.length > 0 && !(coverage.evm && coverage.sol) ? (
          <div className="border-t border-line px-4 py-3">
            <p className="text-xs text-muted">
              {coverage.sol
                ? t("Deployed on Ethereum, BNB Chain, Base or Robinhood too? Connect or import that wallet to list those tokens.")
                : t("Deployed on Solana too? Connect or import your Solana wallet to list those tokens.")}
            </p>
          </div>
        ) : null}
      </section>

      {/*
        Always show the result.

        This was gated on the token list being absent, so once a developer had
        wallets and tokens on screen every outcome — imported, failed, wrong
        key — rendered nothing at all. The action looked like it did nothing
        whether it worked or not, which is the worst of both.
      */}
      {msg ? (
        <p className={cn("text-sm", msg.kind === "ok" ? "text-gain" : "text-loss")}>{msg.text}</p>
      ) : null}

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onProof={submitProof} />

      <CreatorCashback />

      <LiquidityPartner />

      {/* tokens */}
      {profiles && profiles.length > 0 ? (
        <section className="overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <span className="text-label">{t("Tokens you deployed")}</span>
            <div className="flex overflow-hidden rounded border border-line">
              {CHAINS.map((c, i) => (
                <button
                  key={c.v}
                  onClick={() => setChain(c.v)}
                  aria-pressed={chain === c.v}
                  className={cn(
                    "px-2.5 py-1 font-mono text-data-sm transition-colors",
                    i > 0 && "border-l border-line",
                    chain === c.v ? "bg-raised text-amber" : "text-muted hover:text-bone",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {tokens === null ? (
            <Skeleton className="m-4 h-24" />
          ) : /*
               Tokens win over the paste box.

               The fallback used to be chosen on the chain alone, so a wallet
               with tokens found by attribution was shown an empty address
               field instead of its own tokens. The box is what's offered when
               there's genuinely nothing to show, not instead of showing it.
             */
            !supported && tokens.length === 0 ? (
            <div className="flex flex-col gap-3 px-4 py-5">
              <div className="flex gap-2">
                <Input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder={chain === "sol" ? t("Token mint address") : "0x…"}
                  className="font-mono text-data"
                />
                <Button
                  onClick={() =>
                    // a Solana mint carries case; an EVM address does not
                    listToken(chain === "sol" ? manual.trim() : manual.trim().toLowerCase())
                  }
                  disabled={
                    !(chain === "sol"
                      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(manual.trim())
                      : /^0x[0-9a-fA-F]{40}$/.test(manual.trim())) || busy !== null
                  }
                >
                  {busy ? t("Working…") : `${t("List")} ~ ${feeLabel}`}
                </Button>
              </div>
              {statusLine}
            </div>
          ) : tokens.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              {t("No tokens deployed from this wallet on this chain.")}
            </p>
          ) : (
            tokens.map((tk) => (
              <div key={tk.address} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <ChainLogo chain={tk.chain} size={16} />
                <span className="text-sm font-medium text-bone">{tk.symbol}</span>
                <span className="hidden font-mono text-data-sm text-faint sm:inline">{shortAddress(tk.address)}</span>
                {tk.listed ? (
                  <>
                    <Badge variant="gain">{t("On Quant AI")}</Badge>
                    {tk.score != null ? <span className="font-mono text-data-sm text-muted">{tk.score}/100</span> : null}
                    {tk.liquidityUsd ? (
                      <span className="hidden font-mono text-data-sm text-muted md:inline">{usdCompact(tk.liquidityUsd)}</span>
                    ) : null}
                  </>
                ) : (
                  <Badge variant="warn">{t("Not listed")}</Badge>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {tk.listed ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/token/${tk.chain.toLowerCase()}/${tk.address}`}>{t("View")}</Link>
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => listToken(tk.address)} disabled={busy !== null}>
                      {busy === tk.address ? t("Listing…") : `${t("List")} ~ ${feeLabel}`}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/developers/promote?chain=${tk.chain.toLowerCase()}&address=${tk.address}&symbol=${tk.symbol}`}>
                      {t("Promote")}
                    </Link>
                  </Button>
                </span>
              </div>
            ))
          )}
          {tokens && tokens.length > 0 && statusLine ? (
            <div className="border-t border-line px-4 py-3">{statusLine}</div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
