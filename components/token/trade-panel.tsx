"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallets } from "@privy-io/react-auth";
import { formatUnits, parseEther, parseUnits, type Address, type Hex } from "viem";
import { useAuth } from "@/components/auth/auth-context";
import { SolanaTradePanel } from "./solana-trade-panel";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { priceFmt } from "@/lib/mock-series";
import {
  DEX_CONFIG,
  quoteBuy,
  quoteSell,
  tokenMeta,
  allowanceOf,
  applySlippage,
  buildBuyTx,
  buildSellTx,
  buildApproveTx,
  buildApproveFor,
  buildFeeTx,
  feeOf,
  waitForTx,
  publicClient,
  ERC20_ABI,
} from "@/lib/dex";
import {
  v3Supported,
  findV3Route,
  quoteRoute,
  buildV3BuyTx,
  buildV3SellTx,
  v3Router,
  type V3Route,
} from "@/lib/dex-v3";
import type { ChainId, EvmChainId } from "@/lib/chains";

/*
  On-chain trade execution from the embedded wallet.
  Route: V2-style router (Uniswap V2 / PancakeSwap V2), fee-on-transfer-safe
  swaps. Executed trades log to the portfolio automatically with the tx hash.
*/
type Step =
  | { s: "idle" }
  | { s: "quoting" }
  | { s: "switching" }
  | { s: "approving"; hash?: Hex }
  | { s: "signing" }
  | { s: "confirming"; hash: Hex }
  | { s: "done"; hash: Hex; summary: string }
  | { s: "error"; message: string };

const SLIPPAGES = [1, 3, 5, 10];
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

type QuoteEngine = "agg" | "v2" | "v3" | "demo";

/* float → wei bigint without exponential-notation pitfalls on large numbers. */
function numToWei(n: number, decimals: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n;
  const s = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: decimals });
  return parseUnits(s, decimals);
}

/* Query the server swap proxy (aggregator). Returns null when unsupported. */
async function aggQuote(
  chain: string,
  mode: "price" | "quote",
  p: { sellToken: string; buyToken: string; sellAmount: string; taker?: string; slippageBps: number },
) {
  const q = new URLSearchParams({
    mode,
    sellToken: p.sellToken,
    buyToken: p.buyToken,
    sellAmount: p.sellAmount,
    slippageBps: String(p.slippageBps),
  });
  if (p.taker) q.set("taker", p.taker);
  const r = await fetch(`/api/swap/${chain}?${q.toString()}`, { cache: "no-store" });
  return r.json() as Promise<{
    supported: boolean;
    ok?: boolean;
    error?: string;
    buyAmount?: string;
    minBuyAmount?: string;
    transaction?: { to: string; data: string; value?: string } | null;
    allowance?: { spender: string } | null;
  }>;
}

/* Pools we can't route through yet — name the DEX so the user knows why. */
function unsupportedDexNote(dex?: string): string | null {
  if (!dex) return null;
  const d = dex.toLowerCase();
  if (d.includes("v4")) return "Uniswap V4";
  if (d.includes("bankr")) return "Bankr";
  if (d.includes("dyor")) return "DYORswap";
  return null;
}

export function TradePanel(props: {
  chain: string;
  address: string;
  tokenId: string;
  symbol: string;
  priceUsd: number | null;
  dex?: string;
  swapFeeBps?: number;
  feeWallet?: string;
}) {
  const { ready, authenticated, configured } = useAuth();

  if (!configured) return null;
  /*
    Solana has its own execution path — no approvals, no chain switching, a
    complete transaction from the aggregator. It gets its own panel rather than
    branches threaded through every step of this one.
  */
  if (props.chain.toLowerCase() === "sol" && ready && authenticated) {
    return (
      <SolanaTradePanel
        address={props.address}
        symbol={props.symbol}
        tokenId={props.tokenId}
        priceUsd={props.priceUsd ?? null}
      />
    );
  }
  if (!ready) return <div className="h-48 animate-skeleton-pulse rounded-md bg-raised" />;
  if (!authenticated) {
    return (
      <div className="rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">Trade {props.symbol}</span>
        </div>
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-sm text-muted">
            Sign in to trade {props.symbol}.
          </p>
          <Button size="sm" asChild>
            <Link href="/signin">Sign in to trade</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <TradePanelInner {...props} />;
}

function TradePanelInner({
  chain: chainStr,
  address,
  tokenId,
  symbol,
  priceUsd,
  dex,
  swapFeeBps = 0,
  feeWallet = "",
}: {
  chain: string;
  address: string;
  tokenId: string;
  symbol: string;
  priceUsd: number | null;
  dex?: string;
  swapFeeBps?: number;
  feeWallet?: string;
}) {
  const chain = chainStr as EvmChainId;
  const cfg = DEX_CONFIG[chain];
  const gas = chain === "bsc" ? "BNB" : "ETH";
  const token = address as Address;
  // fee only applies when the operator has set a real fee wallet (not shown to users)
  const feeBps = feeWallet && /^0x[0-9a-fA-F]{40}$/.test(feeWallet) ? swapFeeBps : 0;

  const { getToken } = useAuth();
  const { t } = useI18n();
  const { wallets } = useWallets();
  const router = useRouter();
  const wallet = wallets.find((w) => w.walletClientType === "privy");

  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(5);
  const [quote, setQuote] = useState<
    { out: bigint; decimals: number; engine: QuoteEngine; v3Route?: V3Route } | null
  >(null);
  const [holdings, setHoldings] = useState<{ balance: bigint; decimals: number } | null>(null);
  const [nativeBal, setNativeBal] = useState<bigint | null>(null);
  const [step, setStep] = useState<Step>({ s: "idle" });
  const [demo, setDemo] = useState<{
    enabled: boolean;
    cashUsd: number;
    nativeUsd: { eth: number; bnb: number };
    heldToken: number;
  } | null>(null);
  const quoteSeq = useRef(0);

  const owner = wallet?.address as Address | undefined;
  const nativeUsd = chain === "bsc" ? (demo?.nativeUsd.bnb ?? 0) : (demo?.nativeUsd.eth ?? 0);

  // when the pool sits on a DEX we don't route yet, say which one
  const dexNote = unsupportedDexNote(dex);
  const noRouteMessage = dexNote
    ? `${symbol} trades on ${dexNote}, which isn't supported yet — no route available.`
    : "No trading route for this pair — quote unavailable.";

  // quick-buy deep link from the screener: ?buy=<amount> prefills a BUY
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || typeof window === "undefined") return;
    const buy = new URLSearchParams(window.location.search).get("buy");
    if (buy !== null) {
      prefilled.current = true;
      setSide("BUY");
      if (buy) setAmount(buy.replace(/[^0-9.]/g, ""));
    }
  }, []);

  // demo (paper) trading state — silently changes execution when enabled
  const loadDemo = useCallback(async () => {
    const t = await getToken();
    if (!t) return;
    const r = await fetch(`/api/demo?tokenId=${tokenId}`, { headers: { authorization: `Bearer ${t}` } });
    if (r.ok) setDemo(await r.json());
  }, [getToken, tokenId]);
  useEffect(() => {
    loadDemo();
  }, [loadDemo]);

  // effective balances — demo cash/holdings when demo is on, real otherwise
  const demoOn = demo?.enabled ?? false;
  const tokenDecimals = holdings?.decimals ?? 18;
  const availNativeWei = demoOn
    ? numToWei(nativeUsd > 0 ? demo!.cashUsd / nativeUsd : 0, 18)
    : (nativeBal ?? 0n);
  const heldTokenWei = demoOn
    ? numToWei(demo!.heldToken ?? 0, tokenDecimals)
    : (holdings?.balance ?? 0n);

  // balances — skipped in demo mode (no on-chain reads needed, keeps the
  // page snappy); demo balances come from /api/demo instead
  const loadBalances = useCallback(async () => {
    if (!owner || demoOn) return;
    try {
      const [meta, native] = await Promise.all([
        tokenMeta(chain, token, owner),
        publicClient(chain).getBalance({ address: owner }),
      ]);
      setHoldings(meta);
      setNativeBal(native);
    } catch {
      /* non-blocking */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, token, owner, demoOn]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // a completed trade updates the nav balance immediately (no poll wait)
  useEffect(() => {
    if (step.s === "done" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("quantai:balance"));
    }
  }, [step.s]);

  // debounced quote
  useEffect(() => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    const t = setTimeout(async () => {
      const decimals = holdings?.decimals ?? 18; // token decimals (for amountIn + BUY display)
      const sellAmount = (side === "BUY" ? parseEther(amount) : parseUnits(amount, decimals)).toString();
      try {
        setStep((p) => (p.s === "idle" || p.s === "quoting" ? { s: "quoting" } : p));

        // 0) demo — price the trade off the live USD price, no DEX needed
        if (demo?.enabled) {
          if (!priceUsd || priceUsd <= 0 || nativeUsd <= 0) {
            setQuote(null);
            setStep({ s: "error", message: "Quote unavailable — no live price yet." });
            return;
          }
          const out =
            side === "BUY"
              ? numToWei((value * nativeUsd) / priceUsd, decimals) // tokens for the native input
              : numToWei((value * priceUsd) / nativeUsd, 18); // native for the tokens sold
          if (seq === quoteSeq.current) {
            setQuote({ out, decimals, engine: "demo" });
            setStep((p) => (p.s === "quoting" ? { s: "idle" } : p));
          }
          return;
        }

        // 1) aggregator (all DEX versions on ETH/BSC)
        const agg = await aggQuote(chain, "price", {
          sellToken: side === "BUY" ? NATIVE : token,
          buyToken: side === "BUY" ? token : NATIVE,
          sellAmount,
          taker: owner,
          slippageBps: slippage * 100,
        }).catch(() => ({ supported: false }) as Awaited<ReturnType<typeof aggQuote>>);

        if (agg.supported && agg.ok && agg.buyAmount) {
          if (seq !== quoteSeq.current) return;
          setQuote({ out: BigInt(agg.buyAmount), decimals, engine: "agg" });
          setStep((p) => (p.s === "quoting" ? { s: "idle" } : p));
          return;
        }
        // aggregator had no route → keep going, our own routers may still have one

        // 2) our V2 router
        const amountInWei =
          side === "BUY" ? parseEther(amount) - feeOf(parseEther(amount), feeBps) : parseUnits(amount, decimals);
        try {
          const out =
            side === "BUY"
              ? await quoteBuy(chain, token, amountInWei)
              : await quoteSell(chain, token, amountInWei);
          if (out > 0n) {
            if (seq === quoteSeq.current) {
              setQuote({ out, decimals, engine: "v2" });
              setStep((p) => (p.s === "quoting" ? { s: "idle" } : p));
            }
            return;
          }
        } catch {
          /* no V2 pool — try V3 below */
        }

        // 3) V3 pools — direct native pair, or routed through a stable
        if (v3Supported(chain)) {
          const route = await findV3Route(chain, token);
          if (route) {
            const out = quoteRoute(route, amountInWei, side === "BUY");
            if (out > 0n && seq === quoteSeq.current) {
              setQuote({ out, decimals, engine: "v3", v3Route: route });
              setStep((p) => (p.s === "quoting" ? { s: "idle" } : p));
              return;
            }
          }
        }

        if (seq === quoteSeq.current) {
          setQuote(null);
          setStep({ s: "error", message: noRouteMessage });
        }
      } catch {
        if (seq === quoteSeq.current) {
          setQuote(null);
          setStep({ s: "error", message: noRouteMessage });
        }
      }
    }, 450);
    return () => clearTimeout(t);
  }, [amount, side, chain, token, holdings?.decimals, feeBps, slippage, owner, demo?.enabled, nativeUsd, priceUsd]);

  const execute = async () => {
    if (!quote) return;
    const decimals = quote.decimals;

    // demo (paper) trade — no wallet, no chain; records against demo cash
    if (quote.engine === "demo") {
      try {
        setStep({ s: "signing" });
        const amountToken =
          side === "BUY"
            ? Number(formatUnits(quote.out, decimals)) // tokens bought
            : Number(amount); // tokens sold
        const token_ = await getToken();
        const r = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token_}` },
          body: JSON.stringify({ tokenId, side, amountToken, priceUsd }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "Trade failed.");
        setDemo((prev) => (prev ? { ...prev, cashUsd: d.cashUsd } : prev));
        setStep({ s: "done", hash: "0x0" as Hex, summary: side === "BUY" ? "Bought" : "Sold" });
        setAmount("");
        setQuote(null);
        loadDemo();
        router.refresh();
      } catch (e) {
        setStep({ s: "error", message: (e as Error).message?.slice(0, 140) ?? "Trade failed." });
      }
      return;
    }

    if (!wallet || !owner) return;
    try {
      // 1. correct chain
      setStep({ s: "switching" });
      await wallet.switchChain(cfg.chainIdNum);
      const provider = await wallet.getEthereumProvider();

      const minOut = applySlippage(quote.out, slippage);

      if (quote.engine === "agg") {
        // aggregator: fetch a firm quote (with taker) → approve if needed → send
        const res = await aggQuote(chain, "quote", {
          sellToken: side === "BUY" ? NATIVE : token,
          buyToken: side === "BUY" ? token : NATIVE,
          sellAmount: (side === "BUY" ? parseEther(amount) : parseUnits(amount, decimals)).toString(),
          taker: owner,
          slippageBps: slippage * 100,
        });
        if (!res.ok || !res.transaction) throw new Error(res.error ?? "No route available.");

        if (side === "SELL" && res.allowance?.spender) {
          setStep({ s: "approving" });
          const approveHash = (await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: owner, ...buildApproveFor(token, res.allowance.spender as Address) }],
          })) as Hex;
          setStep({ s: "approving", hash: approveHash });
          await waitForTx(chain, approveHash);
        }

        const tx = res.transaction;
        const beforeTok = await publicClient(chain)
          .readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
          .catch(() => 0n);
        const beforeNat = await publicClient(chain).getBalance({ address: owner });

        setStep({ s: "signing" });
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: owner,
              to: tx.to,
              data: tx.data,
              value: tx.value ? (`0x${BigInt(tx.value).toString(16)}` as Hex) : "0x0",
            },
          ],
        })) as Hex;
        setStep({ s: "confirming", hash });
        await waitForTx(chain, hash);

        if (side === "BUY") {
          const afterTok = await publicClient(chain)
            .readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
            .catch(() => beforeTok + minOut);
          const filled = Number(formatUnits(afterTok - beforeTok > 0n ? afterTok - beforeTok : minOut, decimals));
          await logTrade({ side: "BUY", amountToken: filled, amountNative: Number(amount), txHash: hash });
          setStep({
            s: "done",
            hash,
            summary: "Bought",
          });
        } else {
          const afterNat = await publicClient(chain).getBalance({ address: owner });
          const recv = Number(formatUnits(afterNat - beforeNat > 0n ? afterNat - beforeNat : minOut, 18));
          await logTrade({ side: "SELL", amountToken: Number(amount), amountNative: recv, txHash: hash });
          setStep({ s: "done", hash, summary: "Sold" });
        }
      } else if (side === "SELL") {
        const amountIn = parseUnits(amount, decimals);
        // V3 pools use their own router, so approve whichever one we're routing through
        const isV3 = quote.engine === "v3";
        const spender = (isV3 ? v3Router(chain) : cfg.router) as Address;

        // 2. approve if needed
        const allowance = isV3
          ? ((await publicClient(chain)
              .readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, spender] })
              .catch(() => 0n)) as bigint)
          : await allowanceOf(chain, token, owner);
        if (allowance < amountIn) {
          setStep({ s: "approving" });
          const approveHash = (await provider.request({
            method: "eth_sendTransaction",
            params: [
              { from: owner, ...(isV3 ? buildApproveFor(token, spender) : buildApproveTx(chain, token)) },
            ],
          })) as Hex;
          setStep({ s: "approving", hash: approveHash });
          await waitForTx(chain, approveHash);
        }
        // 3. swap
        setStep({ s: "signing" });
        const sellTx =
          isV3 && quote.v3Route
            ? buildV3SellTx(chain, owner, amountIn, minOut, quote.v3Route)
            : buildSellTx(chain, token, owner, amountIn, minOut);
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: owner, ...sellTx }],
        })) as Hex;
        setStep({ s: "confirming", hash });
        const balBefore = await publicClient(chain).getBalance({ address: owner });
        await waitForTx(chain, hash);
        const balAfter = await publicClient(chain).getBalance({ address: owner });
        const grossReceived = balAfter - balBefore > 0n ? balAfter - balBefore : minOut;

        // 4. platform fee on the native proceeds
        const feeWei = feeOf(quote.out, feeBps);
        if (feeWei > 0n && owner) {
          try {
            await provider.request({
              method: "eth_sendTransaction",
              params: [{ from: owner, ...buildFeeTx(feeWallet as Address, feeWei) }],
            });
          } catch {
            /* fee transfer is non-blocking for the user's trade record */
          }
        }
        const receivedNative = Number(formatUnits(grossReceived - feeWei > 0n ? grossReceived - feeWei : grossReceived, 18));

        await logTrade({
          side: "SELL",
          amountToken: Number(amount),
          amountNative: receivedNative,
          txHash: hash,
        });
        setStep({
          s: "done",
          hash,
          summary: "Sold",
        });
      } else {
        // BUY: platform fee off the native input, then swap the remainder
        const grossIn = parseEther(amount);
        const feeWei = feeOf(grossIn, feeBps);
        if (feeWei > 0n && owner) {
          setStep({ s: "signing" });
          const feeHash = (await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: owner, ...buildFeeTx(feeWallet as Address, feeWei) }],
          })) as Hex;
          await waitForTx(chain, feeHash);
        }
        const netIn = grossIn - feeWei;
        // measure token balance delta for the real fill
        const before = await publicClient(chain)
          .readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
          .catch(() => 0n);
        setStep({ s: "signing" });
        const buyTx =
          quote.engine === "v3" && quote.v3Route
            ? buildV3BuyTx(chain, owner, netIn, minOut, quote.v3Route)
            : buildBuyTx(chain, token, owner, netIn, minOut);
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: owner, ...buyTx }],
        })) as Hex;
        setStep({ s: "confirming", hash });
        await waitForTx(chain, hash);
        const after = await publicClient(chain)
          .readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
          .catch(() => before + minOut);
        const filled = Number(formatUnits(after - before > 0n ? after - before : minOut, decimals));

        await logTrade({
          side: "BUY",
          amountToken: filled,
          amountNative: Number(amount),
          txHash: hash,
        });
        setStep({
          s: "done",
          hash,
          summary: "Bought",
        });
      }
      setAmount("");
      setQuote(null);
      loadBalances();
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setStep({
        s: "error",
        message: /rejected|denied/i.test(msg)
          ? "Transaction rejected in wallet."
          : /insufficient/i.test(msg)
            ? `Not enough ${gas} for the trade + gas.`
            : msg.slice(0, 140),
      });
    }
  };

  const logTrade = async (t: {
    side: "BUY" | "SELL";
    amountToken: number;
    amountNative: number;
    txHash: string;
  }) => {
    try {
      const auth = await getToken();
      // Record the true execution price so PnL reads correctly. Prefer the
      // live token price; if it's missing, derive it from the actual trade:
      // priceUsd = (native spent/received × nativeUsd) / tokens.
      let execPrice = priceUsd && priceUsd > 0 ? priceUsd : 0;
      if (execPrice <= 0 && t.amountToken > 0 && nativeUsd > 0) {
        execPrice = (t.amountNative * nativeUsd) / t.amountToken;
      }
      await fetch("/api/trades", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
        body: JSON.stringify({ tokenId, priceUsd: execPrice, executed: true, ...t }),
      });
    } catch {
      /* trade succeeded on-chain regardless */
    }
  };

  const busy = ["switching", "approving", "signing", "confirming"].includes(step.s);
  const holdingsFmt = Number(formatUnits(heldTokenWei, tokenDecimals)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-label">{t("Trade")} {symbol}</span>
        <span className="font-mono text-data-sm text-faint">
          {Number(formatUnits(availNativeWei, 18)).toFixed(4)} {gas}
        </span>
      </div>

      {/* side tabs */}
      <div className="flex border-b border-line">
        {(["BUY", "SELL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setQuote(null);
              setStep({ s: "idle" });
            }}
            aria-pressed={side === s}
            className={cn(
              "flex-1 py-2 font-mono text-data-sm transition-colors duration-fast",
              s === "SELL" && "border-l border-line",
              side === s
                ? s === "BUY"
                  ? "bg-raised text-gain"
                  : "bg-raised text-loss"
                : "text-muted hover:text-bone",
            )}
          >
            {s === "BUY" ? t("Buy") : t("Sell")}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-4 py-4">
        {/* amount */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-label">{side === "BUY" ? `${t("Spend")} (${gas})` : `${t("Sell")} (${symbol})`}</span>
            {side === "SELL" ? (
              <span className="font-mono text-data-sm text-muted">{t("hold")} {holdingsFmt}</span>
            ) : null}
          </div>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={side === "BUY" ? (chain === "eth" ? "0.05" : "0.2") : "1000000"}
            inputMode="decimal"
            className="font-mono text-data"
          />
          <div className="flex gap-1.5">
            {side === "BUY"
              ? (chain === "eth" ? ["0.01", "0.05", "0.1", "0.25"] : ["0.05", "0.2", "0.5", "1"]).map(
                  (v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(v)}
                      className="rounded border border-line px-2 py-0.5 font-mono text-data-sm text-muted transition-colors duration-fast hover:border-line-strong hover:text-bone"
                    >
                      {v}
                    </button>
                  ),
                )
              : [25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      const amt = (heldTokenWei * BigInt(pct)) / 100n;
                      setAmount(formatUnits(amt, tokenDecimals));
                    }}
                    className="rounded border border-line px-2 py-0.5 font-mono text-data-sm text-muted transition-colors duration-fast hover:border-line-strong hover:text-bone"
                  >
                    {pct}%
                  </button>
                ))}
          </div>
        </div>

        {/* quote + slippage */}
        <div className="flex flex-col gap-1.5 rounded border border-line px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-data-sm text-muted">{t("you receive ≈")}</span>
            <span className="font-mono text-data tabular text-bone">
              {step.s === "quoting"
                ? "…"
                : quote
                  ? side === "BUY"
                    ? `${Number(formatUnits(quote.out, quote.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
                    : `${Number(formatUnits(quote.out, 18)).toFixed(5)} ${gas}`
                  : "—"}
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
            <div className="flex items-center justify-between">
              <span className="font-mono text-data-sm text-faint">min received</span>
              <span className="font-mono text-data-sm text-muted">
                {side === "BUY"
                  ? `${Number(formatUnits(applySlippage(quote.out, slippage), quote.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`
                  : `${Number(formatUnits(applySlippage(quote.out, slippage), 18)).toFixed(5)} ${gas}`}
              </span>
            </div>
          ) : null}
        </div>

        {/* execute */}
        <Button
          onClick={execute}
          disabled={busy || !quote || (!wallet && quote?.engine !== "demo")}
          className={cn("w-full", side === "SELL" && "bg-loss text-bone hover:bg-loss/90 shadow-none")}
        >
          {step.s === "switching"
            ? t("Switching chain…")
            : step.s === "approving"
              ? t("Approving…")
              : step.s === "signing"
                ? t("Submitting…")
                : step.s === "confirming"
                  ? t("Confirming on-chain…")
                  : `${side === "BUY" ? t("Buy") : t("Sell")} ${symbol}`}
        </Button>

        {/* status */}
        {step.s === "done" ? (
          <p className="flex items-center gap-1.5 text-xs text-gain">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none">
              <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(step.summary)}
            {step.hash && step.hash !== "0x0" ? (
              <a
                href={cfg.explorerTx + step.hash}
                target="_blank"
                rel="noopener noreferrer"
                className="text-faint underline underline-offset-4 hover:text-muted"
              >
                tx
              </a>
            ) : null}
          </p>
        ) : step.s === "error" ? (
          <p className="text-xs text-loss">{step.message}</p>
        ) : step.s === "confirming" ? (
          <p className="text-xs text-muted">
            Waiting for confirmation ·{" "}
            <a
              href={cfg.explorerTx + step.hash}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              view tx
            </a>
          </p>
        ) : priceUsd ? (
          <p className="font-mono text-data-sm text-faint">ref price {priceFmt(priceUsd)}</p>
        ) : null}
      </div>
    </div>
  );
}
