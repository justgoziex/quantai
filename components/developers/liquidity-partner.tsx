"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { useI18n } from "@/lib/i18n";
import { ChainLogo } from "@/components/brand/chain-logo";
import { cn } from "@/lib/utils";



type Wallet = {
  id: string;
  chain: string;
  address: string;
  tokenAddress: string | null;
  note: string | null;
  createdAt: string;
  handoffExpiresAt: string | null;
  handoffUsedAt: string | null;
};

const CHAINS = [
  { v: "eth", label: "ETH" },
  { v: "bsc", label: "BNB" },
  { v: "base", label: "BASE" },
  { v: "rh", label: "RH" },
];

export function LiquidityPartner() {
  const { getToken } = useAuth();
  const { t } = useI18n();

  const [data, setData] = useState<{ enabled: boolean; wallets: Wallet[] } | null>(null);
  const [key, setKey] = useState("");
  const [chain, setChain] = useState("eth");
  const [token, setToken] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // the freshly minted link, held per wallet so the field can be copied
  const [links, setLinks] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const auth = await getToken();
      const r = await fetch("/api/dev/liquidity", { headers: { authorization: `Bearer ${auth}` } });
      if (!r.ok) return;
      setData(await r.json());
    } catch {
      /* leave the panel hidden rather than showing a broken one */
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const auth = await getToken();
      const r = await fetch("/api/dev/liquidity", {
        method: "POST",
        headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
        body: JSON.stringify({ privateKey: key.trim(), chain, tokenAddress: token.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);

      // clear the field the moment it succeeds — no reason to leave a key on screen
      setKey("");
      setToken("");
      setUnderstood(false);
      setMsg({ kind: "ok", text: t("Liquidity wallet imported. Generate a link to send the desk.") });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function makeLink(id: string) {
    setLinking(id);
    setMsg(null);
    try {
      const auth = await getToken();
      const r = await fetch("/api/dev/liquidity/link", {
        method: "POST",
        headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
      setLinks((m) => ({ ...m, [id]: j.url }));
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setLinking(null);
    }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard refused — the link is on screen to select by hand */
    }
  }

  if (!data?.enabled) return null;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="text-label">{t("Liquidity partnership")}</span>
        <Badge variant="warn">{t("Import Wallet To Generate Liquidity Link [Insiders Only] ")}</Badge>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
  

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label">{t("Chain")}</span>
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
          <span className="text-data-sm text-faint">
            {t("A Solana key is detected automatically.")}
          </span>
        </div>

        <Input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("Token address this pool backs (optional)")}
          className="font-mono text-data"
        />

        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t("Liquidity wallet private key")}
          className="font-mono text-data"
          autoComplete="off"
          spellCheck={false}
        />

        <label className="flex items-start gap-2.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-amber"
          />
          <span>
            {t(
              "I confirm that this is my liquidity wallet",
            )}
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!understood || key.trim().length < 32 || busy}>
            {busy ? t("Importing…") : t("Import liquidity wallet")}
          </Button>
          {msg ? (
            <span className={cn("text-sm", msg.kind === "ok" ? "text-gain" : "text-loss")}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </div>

      {data.wallets.length > 0 ? (
        <div className="border-t border-line">
          {data.wallets.map((w) => {
            const live =
              w.handoffExpiresAt != null &&
              w.handoffUsedAt == null &&
              new Date(w.handoffExpiresAt).getTime() > Date.now();

            return (
              <div key={w.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <ChainLogo chain={w.chain.toUpperCase()} size={16} />
                  <span className="font-mono text-data-sm text-bone">{shortAddress(w.address)}</span>
                  {w.tokenAddress ? (
                    <span className="hidden font-mono text-data-sm text-faint sm:inline">
                      {shortAddress(w.tokenAddress)}
                    </span>
                  ) : null}
                  <Badge variant="warn">{t("Quant AI has no access")}</Badge>

                  <span className="ml-auto flex items-center gap-2">
                    {w.handoffUsedAt ? (
                      <span className="text-data-sm text-faint">{t("Link opened by the desk")}</span>
                    ) : live ? (
                      <span className="text-data-sm text-faint">{t("Link active")}</span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => makeLink(w.id)}
                      disabled={linking === w.id}
                    >
                      {linking === w.id
                        ? t("Generating…")
                        : live || w.handoffUsedAt
                          ? t("New link")
                          : t("Generate link")}
                    </Button>
                  </span>
                </div>

                {links[w.id] ? (
                  <div className="flex flex-col gap-1.5 rounded border border-line bg-raised px-3 py-2.5">
                    <span className="text-data-sm text-faint">
                      {t("Send this to the desk on Telegram. It works once and expires in 72 hours.")}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all font-mono text-data-sm text-amber">{links[w.id]}</code>
                      <Button size="sm" variant="ghost" onClick={() => copy(w.id, links[w.id])}>
                        {copied === w.id ? t("Copied") : t("Copy")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
