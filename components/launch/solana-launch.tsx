"use client";

import { useCallback, useState } from "react";
import {
  useWallets as useSolanaWallets,
  useSignAndSendTransaction as useSolanaSignAndSend,
} from "@privy-io/react-auth/solana";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

/*
  Launching a token on Solana.

  Kept apart from the EVM wizard because the two share almost nothing. There is
  no contract to deploy, no constructor arguments, no gas limit — a token is a
  small account created through the shared Token Program, so the fields that
  matter are different fields.

  The developer signs and pays; the supply lands in their wallet. No liquidity
  is created, because seeding a pool would mean taking their tokens first.
*/

type Step =
  | { s: "form" }
  | { s: "preparing" }
  | { s: "signing" }
  | { s: "done"; mint: string; signature: string }
  | { s: "error"; message: string };

export function SolanaLaunch() {
  const { getToken, solanaAddress } = useAuth();
  const { wallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSolanaSignAndSend();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [decimals, setDecimals] = useState("9");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [revoke, setRevoke] = useState(true);
  const [step, setStep] = useState<Step>({ s: "form" });

  const wallet = wallets.find((w) => w.address === solanaAddress) ?? wallets[0];

  const launch = useCallback(async () => {
    if (!wallet || !solanaAddress) {
      setStep({ s: "error", message: "Connect a Solana wallet first." });
      return;
    }
    setStep({ s: "preparing" });
    try {
      const token = await getToken();
      const r = await fetch("/api/launch/solana", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          owner: solanaAddress,
          name,
          symbol,
          decimals: Number(decimals),
          totalSupply: supply,
          logoUrl,
          description,
          revokeAuthorities: revoke,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setStep({ s: "error", message: d?.error ?? "Couldn't prepare the launch." });
        return;
      }

      setStep({ s: "signing" });
      /*
        The serialized transaction already carries the mint account's own
        signature for its creation; signing here adds the developer's over the
        same bytes without disturbing it.
      */
      const raw = Uint8Array.from(atob(d.transaction), (c) => c.charCodeAt(0));
      const { signature } = await signAndSendTransaction({
        transaction: raw,
        wallet,
        options: { uiOptions: { showWalletUIs: false } },
      });
      const { default: bs58 } = await import("bs58");
      setStep({ s: "done", mint: d.mint, signature: bs58.encode(signature) });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setStep({
        s: "error",
        message: /reject|denied|cancel/i.test(msg)
          ? "Launch cancelled."
          : "That launch didn't go through.",
      });
    }
  }, [wallet, solanaAddress, getToken, name, symbol, decimals, supply, logoUrl, description, revoke, signAndSendTransaction]);

  if (step.s === "done") {
    return (
      <div className="rounded-md border border-line bg-panel p-6">
        <p className="mb-1 text-h2 text-bone">{symbol} is live on Solana</p>
        <p className="mb-4 text-sm text-muted">
          The full supply is in your wallet. Add liquidity on a Solana exchange to make it
          tradeable — until then it exists but has no market.
        </p>
        <p className="mb-4 font-mono text-data-sm text-faint">
          Mint: <span className="text-bone">{step.mint}</span>
        </p>
        <Button asChild>
          <a href={`/token/sol/${step.mint}`}>View on Quant AI</a>
        </Button>
      </div>
    );
  }

  const busy = step.s === "preparing" || step.s === "signing";
  const ready = name.trim().length > 0 && symbol.trim().length > 0 && Number(supply) > 0;

  return (
    <div className="flex flex-col gap-5 rounded-md border border-line bg-panel p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quant Dog" maxLength={32} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Symbol</span>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="QDOG"
            maxLength={10}
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Total supply</span>
          <Input
            value={supply}
            onChange={(e) => setSupply(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Decimals</span>
          <Input
            value={decimals}
            onChange={(e) => setDecimals(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))}
            inputMode="numeric"
            className="font-mono"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-label">Image link</span>
        <Input
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://…/logo.png"
          className="font-mono text-data-sm"
        />
        <span className="text-xs text-faint">
          Wallets read the logo from this link. Anywhere that serves an image over https works.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-label">Description</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What the token is"
          maxLength={300}
        />
      </label>

      {/*
        The one decision that actually changes what the token is. Revoking is
        permanent, so it's presented as a choice with its consequence stated
        rather than buried as a default.
      */}
      <label className="flex cursor-pointer items-start gap-3 rounded border border-line px-4 py-3">
        <input
          type="checkbox"
          checked={revoke}
          onChange={(e) => setRevoke(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-amber"
        />
        <span>
          <span className="block text-sm text-bone">Revoke mint and freeze authority</span>
          <span className="block text-xs text-muted">
            Makes the supply fixed and stops any wallet being frozen. Permanent, and worth a
            large part of the safety score. Leave it off only if you intend to mint more later.
          </span>
        </span>
      </label>

      <Button onClick={launch} disabled={busy || !ready} className={cn("w-full")}>
        {step.s === "preparing"
          ? "Preparing…"
          : step.s === "signing"
            ? "Confirm in your wallet…"
            : "Launch token"}
      </Button>

      <p className="text-xs text-faint">
        You pay the network cost, roughly 0.02 SOL for account rent and fees, and receive the
        entire supply. Liquidity is yours to add afterwards.
      </p>

      {step.s === "error" ? <p className="text-xs text-loss">{step.message}</p> : null}
    </div>
  );
}
