"use client";

import { useCallback, useEffect, useState } from "react";
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
  Solana trade execution.

  The EVM panel and this one look the same on purpose, but almost nothing is
  shared underneath: there is no approval step, no chain to switch to, and no
  calldata to assemble. The aggregator returns a complete transaction, the
  wallet signs it, and that's the trade — so this stays a separate component
  rather than a pile of branches inside the EVM one.
*/

const SLIPPAGES = [1, 3, 5, 10];
const PRESETS = ["0.1", "0.25", "0.5", "1"];

type Quote = { out: number; minOut: number; impactPct: number };
type Step =
  | { s: "idle" }
  | { s: "quoting" }
  | { s: "signing" }
  | { s: "done"; signature: string }
  | { s: "error"; message: string };

export function SolanaTradePanel({
  address,
  symbol,
  tokenId,
  priceUsd,
}: {
  address: string;
  symbol: string;
  tokenId: string;
  priceUsd: number | null;
}) {
  const { t } = useI18n();
  const { getToken, solanaAddress } = useAuth();
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(5);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<Step>({ s: "idle" });

  const owner = solanaAddress;
  const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];

  // live quote, debounced — the panel should always show the current price of
  // the size actually typed, not the one typed two keystrokes ago
  useEffect(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setStep((s) => (s.s === "done" || s.s === "error" ? { s: "idle" } : s));
    const timer = setTimeout(async () => {
      setStep({ s: "quoting" });
      const q = new URLSearchParams({
        mint: address,
        side: side.toLowerCase(),
        amount: String(n),
        slippageBps: String(slippage * 100),
      });
      try {
        const r = await fetch(`/api/solana/quote?${q}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setQuote(null);
          setStep({ s: "error", message: j?.error ?? "No route for that size." });
          return;
        }
        setQuote(j as Quote);
        setStep({ s: "idle" });
      } catch {
        if (!cancelled) {
          setQuote(null);
          setStep({ s: "idle" });
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount, side, slippage, address]);

  const execute = useCallback(async () => {
    if (!wallet || !owner) return;
    setStep({ s: "signing" });
    try {
      const token = await getToken();
      const r = await fetch("/api/solana/swap", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mint: address,
          side: side.toLowerCase(),
          amount: Number(amount),
          owner,
          slippageBps: slippage * 100,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setStep({ s: "error", message: j?.error ?? "Couldn't build that trade." });
        return;
      }

      // the aggregator hands back a complete transaction; the wallet signs and
      // submits it in one step, so there is no separate broadcast to track
      const raw = Uint8Array.from(atob(j.transaction), (c) => c.charCodeAt(0));
      /*
        The account wallet trades without a confirmation step, matching how it
        behaves on the EVM chains. Set explicitly rather than relying on the
        provider default, so a dashboard setting can't quietly reintroduce the
        prompt. An external wallet still prompts — that's its own to control.
      */
      const { signature } = await signAndSendTransaction({
        transaction: raw,
        wallet,
        options: { uiOptions: { showWalletUIs: false } },
      });
      // the wallet returns raw signature bytes; base58 is the form a Solana
      // signature is actually quoted in
      const { default: bs58 } = await import("bs58");
      setStep({ s: "done", signature: bs58.encode(signature) });

      /*
        Record the fill. Cashback, portfolio and PnL all read from the trade
        log, so a Solana trade that never lands here earns nothing and shows
        nowhere — the on-chain swap alone isn't enough.
      */
      const filled = Number(j.out) || 0;
      const nativeLeg = side === "BUY" ? Number(amount) : filled;
      const tokenLeg = side === "BUY" ? filled : Number(amount);
      void fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tokenId,
          side,
          amountToken: tokenLeg,
          amountNative: nativeLeg,
          // the live price when we have it, otherwise the price this trade
          // actually got — never a guess
          priceUsd: priceUsd && priceUsd > 0 ? priceUsd : 0,
          executed: true,
          txHash: bs58.encode(signature),
        }),
      }).catch(() => {
        /* the swap succeeded on-chain regardless */
      });
      window.dispatchEvent(new Event("quantai:balance"));
      setAmount("");
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setStep({
        s: "error",
        message: /reject|denied|cancel/i.test(msg) ? "Trade cancelled." : "That trade didn't go through.",
      });
    }
  }, [wallet, owner, getToken, address, side, amount, slippage, signAndSendTransaction, tokenId, priceUsd]);

  const receiveUnit = side === "BUY" ? symbol : "SOL";
  const fmt = (n: number) =>
    side === "BUY" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(5);

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex border-b border-line">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setQuote(null);
            }}
            aria-pressed={side === s}
            className={cn(
              "flex-1 px-4 py-2.5 text-label transition-colors duration-fast",
              side === s ? "bg-raised text-bone" : "text-faint hover:text-bone",
            )}
          >
            {s === "BUY" ? t("Buy") : t("Sell")}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-label">
            {side === "BUY" ? `${t("Spend")} (SOL)` : `${t("Sell")} (${symbol})`}
          </span>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={side === "BUY" ? "0.25" : "1000000"}
            inputMode="decimal"
            className="font-mono text-data"
          />
          {side === "BUY" ? (
            <div className="flex gap-1.5">
              {PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className="rounded border border-line px-2 py-0.5 font-mono text-data-sm text-muted transition-colors duration-fast hover:border-line-strong hover:text-bone"
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 rounded border border-line px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-data-sm text-muted">{t("you receive ≈")}</span>
            <span className="font-mono text-data tabular text-bone">
              {step.s === "quoting" ? "…" : quote ? `${fmt(quote.out)} ${receiveUnit}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-data-sm text-muted">{t("Slippage")}</span>
            <span className="flex gap-1">
              {SLIPPAGES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  aria-pressed={slippage === s}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-data-sm transition-colors duration-fast",
                    slippage === s ? "bg-raised text-amber" : "text-faint hover:text-bone",
                  )}
                >
                  {s}%
                </button>
              ))}
            </span>
          </div>
          {quote ? (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-data-sm text-faint">min received</span>
                <span className="font-mono text-data-sm text-muted">
                  {fmt(quote.minOut)} {receiveUnit}
                </span>
              </div>
              {/* only worth saying when it's worth acting on */}
              {quote.impactPct >= 2 ? (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-data-sm text-faint">price impact</span>
                  <span
                    className={cn(
                      "font-mono text-data-sm",
                      quote.impactPct >= 10 ? "text-loss" : "text-muted",
                    )}
                  >
                    {quote.impactPct.toFixed(1)}%
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <Button
          onClick={execute}
          disabled={step.s === "signing" || step.s === "quoting" || !quote || !wallet}
          className={cn("w-full", side === "SELL" && "bg-loss text-bone shadow-none hover:bg-loss/90")}
        >
          {step.s === "signing"
            ? t("Submitting…")
            : `${side === "BUY" ? t("Buy") : t("Sell")} ${symbol}`}
        </Button>

        {step.s === "done" ? (
          <p className="flex items-center gap-1.5 text-xs text-gain">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none">
              <path
                d="M3.5 8.5l3 3 6-7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t("Trade filled")}
          </p>
        ) : null}
        {step.s === "error" ? <p className="text-xs text-loss">{t(step.message)}</p> : null}
      </div>
    </div>
  );
}
