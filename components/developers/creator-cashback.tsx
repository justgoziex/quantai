"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/*
  Creator cashback.

  What a developer earns back on tokens they listed, scaled by how those tokens
  actually performed. Every token they've listed is shown, including the ones
  that don't qualify and why — a panel that hides what didn't pay leaves people
  guessing at the rule, and the rule is the whole point.

  Only open to developers whose deployer key is imported, because this pays out
  to a wallet and that's a standing relationship rather than a signature.
*/

type Row = {
  chain: string;
  tokenAddress: string;
  symbol: string;
  asset: string;
  alreadyClaimed: boolean;
  eligible: boolean;
  amountNative?: number;
  reason?: string;
};

type Claim = {
  id: string;
  chain: string;
  symbol: string | null;
  amountNative: number;
  asset: string;
  status: string;
  createdAt: string;
};

export function CreatorCashback() {
  const { getToken } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<{
    enabled: boolean;
    eligibleWallet: boolean;
    tokens: Row[];
    claims: Claim[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const r = await fetch("/api/dev/cashback", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      setData(await r.json());
    } catch {
      /* the panel simply stays empty */
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = async (row: Row) => {
    setMsg(null);
    setBusy(`${row.chain}:${row.tokenAddress}`);
    try {
      const token = await getToken();
      const r = await fetch("/api/dev/cashback", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ chain: row.chain.toLowerCase(), tokenAddress: row.tokenAddress }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? t("Couldn't submit that claim."));
      setMsg({
        kind: "ok",
        text: t("Claim submitted — the desk will review and send it."),
      });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Skeleton className="h-40 rounded-md" />;

  /*
    Shown whether or not it's open and whether or not this developer qualifies.
    A creator who can't see the table has no reason to import their wallet, and
    the point of the panel is to tell them what's on offer.
  */
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <span className="text-label">{t("Creator cashback")}</span>
      <span className="font-mono text-data-sm text-faint">
        {t("for imported dev wallets only")}
      </span>
    </div>
  );

  if (!data.enabled) {
    return (
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        {header}
        <p className="px-4 py-5 text-sm text-muted">
          {t("Earn back on the tokens you launch, paid in that chain's own asset.")}
        </p>
      </section>
    );
  }

  if (!data.eligibleWallet) {
    return (
      <section className="overflow-hidden rounded-md border border-line bg-panel">
        {header}
        <p className="px-4 py-5 text-sm text-muted">
          {t("Earn back on the tokens you launch, paid in that chain's own asset. Import your deployer key to take part — cashback pays to that wallet, so it has to be one we can pay.")}
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      {header}

      {data.tokens.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          {t("List a token to start earning cashback on it.")}
        </p>
      ) : (
        data.tokens.map((row) => (
          <div
            key={`${row.chain}:${row.tokenAddress}`}
            className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0"
          >
            <span className="min-w-24 font-mono text-data-sm text-bone">{row.symbol}</span>
            <Badge variant="neutral">{row.chain}</Badge>

            <span className="ml-auto flex items-center gap-3">
              {row.alreadyClaimed ? (
                <Badge variant="gain">{t("Claimed")}</Badge>
              ) : row.eligible ? (
                <>
                  <span className="font-mono text-data text-bone">
                    {row.amountNative} {row.asset}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => claim(row)}
                    disabled={busy === `${row.chain}:${row.tokenAddress}`}
                  >
                    {busy === `${row.chain}:${row.tokenAddress}` ? t("Claiming…") : t("Claim")}
                  </Button>
                </>
              ) : (
                /* say why, rather than showing a disabled button with no reason */
                <span className="text-right text-xs text-faint">{row.reason}</span>
              )}
            </span>
          </div>
        ))
      )}

      {data.claims.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <p className="mb-2 text-label">{t("Your claims")}</p>
          {data.claims.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-1">
              <span className="font-mono text-data-sm text-bone">{c.symbol ?? "—"}</span>
              <span className="font-mono text-data-sm text-muted">
                {c.amountNative} {c.asset}
              </span>
              <Badge
                variant={c.status === "PAID" ? "gain" : c.status === "REJECTED" ? "loss" : "neutral"}
                className="ml-auto"
              >
                {c.status === "PENDING"
                  ? t("Under review")
                  : c.status === "APPROVED"
                    ? t("Approved")
                    : c.status === "PAID"
                      ? t("Paid")
                      : t("Rejected")}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p className={cn("px-4 pb-3 text-sm", msg.kind === "ok" ? "text-gain" : "text-loss")}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
