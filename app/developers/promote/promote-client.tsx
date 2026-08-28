"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallets } from "@privy-io/react-auth";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/product/empty-state";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { planFeePayment, executeFeePayment, type Holding } from "@/lib/fee-autopay";
import { supportsBatch, sendCallsBatch } from "@/lib/wallet-batch";
import type { ChainId } from "@/lib/chains";
import { cn } from "@/lib/utils";

/*
  Buy a promoted ad slot for a token — the rotating banner across the screener
  and token pages. Pay on-chain, campaign goes live immediately.
*/
type Campaign = {
  id: string;
  chain: string;
  tokenAddress: string;
  symbol: string;
  days: number;
  feeEth: number;
  status: string;
  impressions: number;
  clicks: number;
  endsAt: string | null;
  createdAt: string;
};

const CHAINS = [
  { v: "eth", label: "Ethereum", native: "ETH", id: 1 },
  { v: "bsc", label: "BNB Chain", native: "BNB", id: 56 },
  { v: "base", label: "Base", native: "ETH", id: 8453 },
  { v: "rh", label: "Robinhood", native: "ETH", id: 4663 },
] as const;

export function PromoteClient() {
  const params = useSearchParams();
  const { ready, authenticated, getToken } = useAuth();
  const { wallets } = useWallets();
  const { t } = useI18n();

  const [chain, setChain] = useState<string>(params.get("chain") ?? "eth");
  const [address, setAddress] = useState(params.get("address") ?? "");
  const [symbol, setSymbol] = useState(params.get("symbol") ?? "");
  const [headline, setHeadline] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [days, setDays] = useState(3);
  const [pricePerDay, setPricePerDay] = useState(0);
  const [feeWallet, setFeeWallet] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const authed = useCallback(async () => ({ authorization: `Bearer ${await getToken()}` }), [getToken]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ads/buy", { headers: await authed() });
      if (!r.ok) return;
      const d = await r.json();
      setPricePerDay(d.pricePerDayEth ?? 0);
      setFeeWallet(d.feeWallet ?? "");
      setCampaigns(d.campaigns ?? []);
    } catch {
      /* retry next visit */
    }
  }, [authed]);

  useEffect(() => {
    if (ready && authenticated) load();
  }, [ready, authenticated, load]);

  const chainMeta = CHAINS.find((c) => c.v === chain) ?? CHAINS[0];
  const total = pricePerDay * days;

  const buy = async () => {
    setMsg(null);
    // a Solana mint is base58, not hex — demanding hex rejected them outright
    const addr = address.trim();
    const validAddress =
      /^0x[0-9a-fA-F]{40}$/.test(addr) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    if (!validAddress) {
      setMsg({ kind: "err", text: t("Enter a valid contract address.") });
      return;
    }
    setBusy(true);
    try {
      let feeTxHash: string | undefined;
      if (total > 0) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(feeWallet)) throw new Error(t("Payments aren't configured yet."));
        const w = wallets[0];
        if (!w) throw new Error(t("Connect a wallet to pay."));
        await w.switchChain(chainMeta.id);
        const provider = await w.getEthereumProvider();
        const send = async (tx: { to: string; data?: string; value?: string }) =>
          (await provider.request({
            method: "eth_sendTransaction",
            params: [{ from: w.address, to: tx.to, data: tx.data ?? "0x", value: tx.value ?? "0x0" }],
          })) as `0x${string}`;

        // pay with any holding that covers it — the desk is credited natively
        const hres = await fetch(`/api/fees/holdings?chain=${chain}&include=${address.trim()}`, {
          headers: await authed(),
        });
        const h = (await hres.json().catch(() => ({}))) as Record<string, unknown>;
        const plan = await planFeePayment({
          chain: chain as ChainId,
          owner: w.address as `0x${string}`,
          feeNative: total,
          nativeBalance: Number(h.nativeBalance ?? 0),
          holdings: (h.holdings as Holding[]) ?? [],
          tolerancePct: Number(h.feeTolerancePct ?? 0),
        });
        if (plan.kind === "none") throw new Error(plan.shortfall);
        /*
          One confirmation for approve + swap + pay where the wallet supports
          batched calls; otherwise each step is signed separately.
        */
        const canBatch = await supportsBatch(provider, chainMeta.id);
        feeTxHash = await executeFeePayment({
          chain: chain as ChainId,
          owner: w.address as `0x${string}`,
          feeWallet: feeWallet as `0x${string}`,
          plan,
          send,
          sendBatch: canBatch ? (calls) => sendCallsBatch(provider, w.address, chainMeta.id, calls) : undefined,
        });
      }

      // the server confirms the payment on-chain (202 while pending) — the
      // browser never touches a chain RPC
      for (let attempt = 0; ; attempt++) {
        const r = await fetch("/api/ads/buy", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authed()) },
          body: JSON.stringify({ chain, tokenAddress: address.trim(), symbol, days, headline, ctaUrl, feeTxHash }),
        });
        const text = await r.text().catch(() => "");
        const d = (text.trim() ? JSON.parse(text) : {}) as Record<string, unknown>;
        if (r.ok) {
          setMsg({ kind: "ok", text: t("Your ad is live — it's rotating on the screener now.") });
          setHeadline("");
          await load();
          return;
        }
        const stillPending = r.status === 202 || d.pending === true;
        if (!stillPending) throw new Error((d.error as string) ?? t("Purchase failed."));
        if (attempt >= 24) throw new Error(t("Still confirming — reopen this page shortly."));
        await new Promise((res) => setTimeout(res, 5000));
      }
    } catch (e) {
      let m = (e as Error).message ?? "";
      if (/reject|denied/i.test(m)) m = t("Payment cancelled.");
      else if (/couldn't be read|is missing|unexpected end|not valid json|load failed|failed to fetch/i.test(m)) {
        m = t("Network hiccup — nothing was lost. Try again.");
      }
      setMsg({ kind: "err", text: m.slice(0, 160) });
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <Skeleton className="h-64 rounded-md" />;
  if (!authenticated) {
    return (
      <EmptyState
        label={t("Promote")}
        title={t("Sign in to buy an ad slot")}
        description={t("Top of the screener and every token page.")}
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
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">{t("New ad campaign")}</span>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-label">{t("Chain")}</label>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="h-10 rounded border border-line bg-raised px-3 font-mono text-data text-bone outline-none focus:border-amber"
            >
              {CHAINS.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label">{t("Token contract")}</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" className="font-mono text-data" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label">{t("Headline")} <span className="text-faint">({t("optional")})</span></label>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value.slice(0, 80))} placeholder={t("Fair launch · LP locked 12mo")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label">{t("Link")} <span className="text-faint">({t("optional")})</span></label>
            <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
          <span className="text-label">{t("Duration")}</span>
          <div className="flex overflow-hidden rounded border border-line">
            {[1, 3, 7, 14, 30].map((d, i) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={cn(
                  "px-3 py-1.5 font-mono text-data-sm transition-colors",
                  i > 0 && "border-l border-line",
                  days === d ? "bg-raised text-amber" : "text-muted hover:text-bone",
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          <span className="font-mono text-data text-bone">
            {total.toFixed(4)} {chainMeta.native}
          </span>
          <Button className="ml-auto" onClick={buy} disabled={busy}>
            {busy ? t("Processing…") : t("Buy ad slot")}
          </Button>
        </div>
        {msg ? (
          <p className={cn("border-t border-line px-4 py-2.5 text-sm", msg.kind === "ok" ? "text-gain" : "text-loss")}>
            {msg.text}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">{t("Your campaigns")}</span>
        </div>
        {campaigns === null ? (
          <Skeleton className="m-4 h-16" />
        ) : campaigns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">{t("No campaigns yet.")}</p>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="text-sm font-medium text-bone">{c.symbol}</span>
              <Badge variant={c.status === "ACTIVE" ? "gain" : c.status === "ENDED" ? "neutral" : "warn"}>{c.status}</Badge>
              <span className="font-mono text-data-sm text-muted">{c.days}d · {c.feeEth.toFixed(4)}</span>
              <span className="font-mono text-data-sm text-faint">
                {c.impressions} {t("views")} · {c.clicks} {t("clicks")}
              </span>
              {c.endsAt ? (
                <span className="ml-auto font-mono text-data-sm text-faint">
                  {t("ends")} <LiveTimeAgo date={c.endsAt} />
                </span>
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
