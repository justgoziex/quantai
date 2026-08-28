"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import type { Hex } from "viem";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { publicClient } from "@/lib/dex";

/*
  Redeem vested ETH rewards to a wallet. The user picks a destination from
  their connected wallets, pays the admin-set redemption fee on-chain, and the
  request lands in the admin queue — the admin sends the ETH and marks it paid.
*/
type RedeemRequest = {
  id: string;
  points: number;
  wallet: string;
  status: string;
  createdAt: string;
};

const ethFmt = (points: number) => {
  const eth = points / 1_000_000;
  if (eth === 0) return "0 ETH";
  const v = Math.abs(eth) >= 0.01 ? eth.toFixed(4) : eth.toFixed(6);
  return `${v.replace(/\.?0+$/, "")} ETH`;
};

export function RedeemCard({ onRedeemed }: { onRedeemed: () => void }) {
  const { getToken, wallets: authWallets, walletAddress } = useAuth();
  const { wallets: privyWallets } = useWallets();
  const [externals, setExternals] = useState<string[]>([]);
  const [requests, setRequests] = useState<RedeemRequest[]>([]);
  const [claimablePoints, setClaimablePoints] = useState(0);
  const [feeEth, setFeeEth] = useState(0);
  const [feeWallet, setFeeWallet] = useState("");
  const [dest, setDest] = useState("");
  const [step, setStep] = useState<
    { s: "idle" } | { s: "fee" } | { s: "submitting" } | { s: "done" } | { s: "error"; message: string }
  >({ s: "idle" });

  const load = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) return;
      const [rr, wr] = await Promise.all([
        fetch("/api/rewards/redeem", { headers: { authorization: `Bearer ${t}` } }),
        fetch("/api/rewards/wallet", { headers: { authorization: `Bearer ${t}` } }),
      ]);
      if (rr.ok) {
        const d = await rr.json();
        setRequests(d.requests ?? []);
        setFeeEth(d.feeEth ?? 0);
        setFeeWallet(d.feeWallet ?? "");
        setClaimablePoints(d.claimablePoints ?? 0);
      }
      if (wr.ok) {
        const d = await wr.json();
        setExternals(((d.wallets ?? []) as { address: string }[]).map((w) => w.address));
      }
    } catch {
      /* retry next visit */
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  // every wallet on the account: embedded + linked + external trading wallets
  const options = Array.from(
    new Set(
      [...authWallets.map((w) => w.address), ...externals, walletAddress ?? ""]
        .filter(Boolean)
        .map((a) => a.toLowerCase()),
    ),
  );

  useEffect(() => {
    if (!dest && options.length > 0) setDest(options[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length]);

  const pending = requests.find((r) => r.status === "PENDING");
  const feeOn = feeEth > 0 && /^0x[0-9a-fA-F]{40}$/.test(feeWallet);

  const redeem = async () => {
    if (!dest) return;
    try {
      let feeTxHash: string | undefined;
      if (feeOn) {
        const wallet = privyWallets.find((w) => w.walletClientType === "privy") ?? privyWallets[0];
        if (!wallet) throw new Error("No wallet available to pay the fee.");
        setStep({ s: "fee" });
        await wallet.switchChain(1);
        const provider = await wallet.getEthereumProvider();
        const wei = BigInt(Math.round(feeEth * 1e6)) * 10n ** 12n;
        feeTxHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, to: feeWallet, value: `0x${wei.toString(16)}` }],
        })) as string;
        await publicClient("eth").waitForTransactionReceipt({ hash: feeTxHash as Hex, timeout: 120_000 });
      }
      setStep({ s: "submitting" });
      const t = await getToken();
      const r = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify({ wallet: dest, feeTxHash }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? "Redemption failed.");
      setStep({ s: "done" });
      load();
      onRedeemed();
    } catch (e) {
      const msg = (e as Error).message ?? "Redemption failed.";
      setStep({
        s: "error",
        message: /rejected|denied/i.test(msg) ? "Fee payment rejected in wallet." : msg.slice(0, 140),
      });
    }
  };

  const busy = step.s === "fee" || step.s === "submitting";

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-label">Claim rewards to wallet</span>
        <span className="font-mono text-data-sm text-muted">
          claimable {ethFmt(claimablePoints)}
        </span>
      </div>

      {pending ? (
        <div className="flex items-center gap-3 px-4 py-4">
          <Badge variant="warn">In review</Badge>
          <p className="text-sm text-muted">
            {ethFmt(pending.points)} → {shortAddress(pending.wallet)} — the desk pays out
            redemptions manually; it lands in this wallet shortly.
          </p>
        </div>
      ) : claimablePoints <= 0 ? (
        <p className="px-4 py-5 text-sm text-muted">Nothing to redeem yet.</p>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-label" htmlFor="redeem-wallet">
              Destination wallet
            </label>
            <select
              id="redeem-wallet"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="h-10 w-full rounded border border-line bg-raised px-3 font-mono text-data-sm text-bone outline-none focus:border-amber"
            >
              {options.map((a) => (
                <option key={a} value={a}>
                  {shortAddress(a)}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={redeem} disabled={busy || !dest}>
            {step.s === "fee"
              ? "Paying fee…"
              : step.s === "submitting"
                ? "Submitting…"
                : `Redeem ${ethFmt(claimablePoints)}`}
          </Button>
          {step.s === "error" ? (
            <p className="text-xs text-loss">{step.message}</p>
          ) : step.s === "done" ? (
            <p className="text-xs text-gain">Request submitted — the desk sends your rewards to this wallet after review.</p>
          ) : (
            <p className="text-xs text-faint">
              {feeOn
                ? `You pay a ${feeEth} ETH network fee, then the desk transfers your rewards to this wallet.`
                : "Sent after review."}
            </p>
          )}
        </div>
      )}

      {requests.filter((r) => r.status !== "PENDING").length > 0 ? (
        <div className="border-t border-line">
          {requests
            .filter((r) => r.status !== "PENDING")
            .slice(0, 5)
            .map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <Badge variant={r.status === "PAID" ? "gain" : "loss"}>{r.status}</Badge>
                <span className="font-mono text-data-sm text-muted">
                  {ethFmt(r.points)} → {shortAddress(r.wallet)}
                </span>
                <span className="ml-auto font-mono text-data-sm text-faint">
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
