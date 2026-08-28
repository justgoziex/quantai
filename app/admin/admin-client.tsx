"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-context";
import { AdminStatusBar } from "@/components/admin/status-bar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/product/empty-state";
import { SignalScore } from "@/components/product/signal-score";
import { PnlCard, type PnlPosition } from "@/components/portfolio/pnl-card";
import { timeAgo, usdCompact } from "@/lib/format";
import { LiveTimeAgo } from "@/components/ui/live-time";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <p className="text-label mb-1">{label}</p>
      <p className="font-mono text-data-lg tabular text-bone">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export function AdminClient() {
  const { ready, authenticated, getToken } = useAuth();
  const [access, setAccess] = useState<"checking" | "granted" | "denied">("checking");
  const [overview, setOverview] = useState<any>(null);

  /*
    A handoff link arrives as /admin?liquidity=<ref>. Landing on Overview and
    making the desk hunt for the right tab would defeat the point of sending a
    link at all, so the parameter picks the tab.

    Declared with the other hooks, above the access checks. Below them it sat
    after two early returns, so the render that granted access ran more hooks
    than the one before it and React tore the page down.
  */
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("liquidity")) setTab("liquidity");
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const r = await fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
      });
      if (r.status === 403) throw new Error("forbidden");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      return d;
    },
    [getToken],
  );

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setAccess("denied");
      return;
    }
    api("/api/admin/overview")
      .then((d) => {
        setOverview(d);
        setAccess("granted");
      })
      .catch(() => setAccess("denied"));
  }, [ready, authenticated, api]);

  if (!ready || access === "checking") {
    return <Skeleton className="h-96 rounded-md" />;
  }

  if (access === "denied") {
    return (
      <EmptyState
        label="Admin"
        title="Operators only"
        description="Admin account required."
        action={
          <Button variant="secondary" asChild>
            <Link href={authenticated ? "/" : "/signin"}>
              {authenticated ? "Back home" : "Sign in"}
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* above the tabs, so a failure is seen before anything else is done */}
      <AdminStatusBar />
      <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="wallets">Wallets</TabsTrigger>
        <TabsTrigger value="demo">Demo</TabsTrigger>
        <TabsTrigger value="devs">Devs & Ads</TabsTrigger>
        <TabsTrigger value="cashback">Cashback</TabsTrigger>
        <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
        <TabsTrigger value="pnl">PnL card</TabsTrigger>
        <TabsTrigger value="config">Config</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab data={overview} />
      </TabsContent>
      <TabsContent value="users">
        <UsersTab api={api} />
      </TabsContent>
      <TabsContent value="tokens">
        <TokensTab api={api} />
      </TabsContent>
      <TabsContent value="wallets">
        <WalletsTab api={api} />
      </TabsContent>
      <TabsContent value="demo">
        <DemoTab api={api} />
      </TabsContent>
      <TabsContent value="devs">
        <DevsTab api={api} />
      </TabsContent>
      <TabsContent value="cashback">
        <CashbackTab api={api} />
      </TabsContent>
      <TabsContent value="liquidity">
        <LiquidityTab api={api} />
      </TabsContent>
      <TabsContent value="pnl">
        <PnlGeneratorTab />
      </TabsContent>
      <TabsContent value="config">
        <ConfigTab api={api} />
      </TabsContent>
      <TabsContent value="audit">
        <AuditTab api={api} />
      </TabsContent>
    </Tabs>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────── */
function OverviewTab({ data }: { data: any }) {
  if (!data) return <Skeleton className="h-64 rounded-md" />;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <p className="text-label mb-3">Users</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
          <StatCard label="Total" value={data.users.total} />
          <StatCard label="New · 7d" value={data.users.new7d} />
          <StatCard label="DAU" value={data.users.dau} sub="activity proxy" />
          <StatCard label="MAU" value={data.users.mau} sub="activity proxy" />
          <StatCard label="Suspended" value={data.users.suspended} />
        </div>
      </section>
      <section>
        <p className="text-label mb-3">Tokens & signals</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
          <StatCard label="Tokens" value={data.tokens.total} sub={`${data.tokens.freshWithin2min} fresh <2min`} />
          <StatCard label="New feed" value={data.tokens.byCategory.new ?? 0} />
          <StatCard label="Trending" value={data.tokens.byCategory.trending ?? 0} />
          <StatCard label="Blacklisted" value={data.tokens.blacklisted} />
          <StatCard
            label="Signals · 7d"
            value={data.signals.last7d}
            sub={Object.entries(data.signals.byType7d).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}
          />
        </div>
      </section>
      <section>
        <p className="text-label mb-3">Referral funnel & activity</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
          <StatCard label="Pending" value={data.referrals.PENDING ?? 0} />
          <StatCard label="Qualified" value={data.referrals.QUALIFIED ?? 0} />
          <StatCard label="Points issued" value={data.rewards.pointsIssued} />
          <StatCard label="Trades" value={data.activity.tradesTotal} sub={`${data.activity.trades24h} in 24h`} />
          <StatCard label="Launches" value={data.activity.launchesTotal} />
        </div>
      </section>
    </div>
  );
}

/* ── Users ────────────────────────────────────────────────────── */
function UsersTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    (query: string) =>
      api(`/api/admin/users?q=${encodeURIComponent(query)}`).then((d) => setUsers(d.users)),
    [api],
  );
  useEffect(() => {
    load("");
  }, [load]);

  const act = async (userId: string, action: string, extra?: object) => {
    setBusy(userId + action);
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ userId, action, ...extra }) });
      await load(q);
    } finally {
      setBusy(null);
    }
  };

  const grant = async (userId: string) => {
    const input = window.prompt("Grant points (negative to deduct):", "100");
    if (input === null) return;
    const points = Number(input);
    if (!Number.isFinite(points) || points === 0) return;
    await act(userId, "grantPoints", { points });
  };

  const setFee = async (userId: string, current: number | null) => {
    const input = window.prompt(
      "Redemption network fee for THIS user, in ETH (blank = use the global fee):",
      current != null ? String(current) : "",
    );
    if (input === null) return;
    const feeEth = input.trim() === "" ? null : Number(input);
    if (feeEth !== null && (!Number.isFinite(feeEth) || feeEth < 0)) return;
    await act(userId, "setRedemptionFee", { feeEth });
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        className="flex max-w-md gap-2"
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email or privy id…" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {users === null ? (
        <Skeleton className="h-48 rounded-md" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex min-w-[760px] items-center gap-4 border-b border-line bg-panel px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-bone">{u.email ?? "no email"}</p>
                <p className="font-mono text-data-sm text-faint">
                  joined {timeAgo(u.createdAt)} · {u._count.trades} trades · {u._count.launches} launches ·{" "}
                  {u._count.referralsMade} referrals
                  {u.redemptionFeeEth != null ? ` · fee ${u.redemptionFeeEth} ETH` : ""}
                </p>
              </div>
              <Badge variant={u.role === "ADMIN" ? "amber" : "neutral"}>{u.role}</Badge>
              <Badge variant={u.status === "ACTIVE" ? "gain" : "loss"}>{u.status}</Badge>
              <div className="flex gap-2">
                {u.status === "ACTIVE" ? (
                  <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => act(u.id, "suspend")}>
                    {busy === u.id + "suspend" ? "…" : "Suspend"}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act(u.id, "activate")}>
                    {busy === u.id + "activate" ? "…" : "Activate"}
                  </Button>
                )}
                {u.role === "ADMIN" ? (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(u.id, "revokeAdmin")}>
                    Revoke admin
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(u.id, "makeAdmin")}>
                    Make admin
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => grant(u.id)}>
                  Grant points
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setFee(u.id, u.redemptionFeeEth ?? null)}>
                  Set fee
                </Button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="bg-panel px-4 py-8 text-center text-sm text-muted">No users match.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Tokens ───────────────────────────────────────────────────── */
function TokensTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [q, setQ] = useState("");
  const [tokens, setTokens] = useState<any[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // ban an address outright, listed or not
  const [banChain, setBanChain] = useState("sol");
  const [banAddr, setBanAddr] = useState("");
  const [banMsg, setBanMsg] = useState<string | null>(null);

  const load = useCallback(
    (query: string) =>
      api(`/api/admin/tokens?q=${encodeURIComponent(query)}`).then((d) => setTokens(d.tokens)),
    [api],
  );
  useEffect(() => {
    load("");
  }, [load]);

  const act = async (
    tokenId: string,
    action: "blacklist" | "unblacklist" | "delete" | "recategorize" | "clearAiCache" | "promote" | "unpromote",
    extra?: object,
  ) => {
    if (action === "blacklist" && !reason.trim()) return;
    if (action === "delete" && !window.confirm("Delete this token and its signals? This can't be undone.")) return;
    setBusy(tokenId);
    try {
      await api("/api/admin/tokens", {
        method: "POST",
        body: JSON.stringify({ tokenId, action, reason: reason.trim() || undefined, ...extra }),
      });
      await load(q);
    } finally {
      setBusy(null);
    }
  };

  const banAddress = async () => {
    if (!banAddr.trim() || !reason.trim()) {
      setBanMsg("An address and a reason are both required.");
      return;
    }
    setBusy("ban");
    setBanMsg(null);
    try {
      const r = await api("/api/admin/tokens", {
        method: "POST",
        body: JSON.stringify({
          action: "blacklistAddress",
          chain: banChain,
          address: banAddr.trim(),
          reason: reason.trim(),
        }),
      });
      setBanMsg(
        r?.preemptive
          ? "Blocked. It was not listed, so it is now banned in advance and can never be pulled in."
          : "Blocked. It was already listed and is now blacklisted.",
      );
      setBanAddr("");
      await load(q);
    } catch (e: any) {
      setBanMsg(e?.message ?? "Could not block that address.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        Blocking by address, separate from the list below.

        The list can only act on tokens that exist, so a token the desk wants
        kept out was unreachable until it had already appeared.
      */}
      <div className="flex flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3">
        <span className="text-label">Block an address</span>
        <div className="flex flex-wrap gap-2">
          <select
            value={banChain}
            onChange={(e) => setBanChain(e.target.value)}
            className="rounded border border-line bg-raised px-3 py-2 font-mono text-data-sm text-bone"
          >
            {["sol", "eth", "bsc", "base", "rh"].map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <Input
            value={banAddr}
            onChange={(e) => setBanAddr(e.target.value)}
            placeholder="Contract address or Solana mint"
            className="min-w-[20rem] flex-1 font-mono text-data"
          />
          <Button onClick={banAddress} disabled={busy === "ban"}>
            {busy === "ban" ? "Blocking…" : "Block"}
          </Button>
        </div>
        <span className="text-sm text-muted">
          {banMsg ?? "Works whether or not the token has ever been listed. Uses the reason field below."}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(q);
          }}
          className="flex max-w-md flex-1 gap-2"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol, name, or address… (empty = blacklist)" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Blacklist reason (required)"
          className="max-w-xs"
        />
      </div>

      {tokens === null ? (
        <Skeleton className="h-48 rounded-md" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex min-w-[720px] items-center gap-4 border-b border-line bg-panel px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-bone">
                  {t.symbol} <span className="text-muted">· {t.chain}</span>
                </p>
                <p className="truncate font-mono text-data-sm text-faint">
                  {t.address} · liq {usdCompact(t.liquidityUsd)}
                  {t.blacklistReason ? ` · reason: ${t.blacklistReason}` : ""}
                </p>
              </div>
              <SignalScore score={t.currentScore} size="sm" />
              {t.promoted ? (
                <Button size="sm" variant="secondary" disabled={busy === t.id} onClick={() => act(t.id, "unpromote")}>
                  Unpromote
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === t.id}
                  onClick={() => {
                    const d = window.prompt("Promote for how many days?", "7");
                    if (d === null) return;
                    act(t.id, "promote", { days: Math.max(1, Number(d) || 7) });
                  }}
                >
                  Promote
                </Button>
              )}
              {t.blacklisted ? (
                <>
                  <Badge variant="loss">Blacklisted</Badge>
                  <Button size="sm" variant="secondary" disabled={busy === t.id} onClick={() => act(t.id, "unblacklist")}>
                    Restore
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === t.id || !reason.trim()}
                  title={!reason.trim() ? "Enter a reason first" : undefined}
                  onClick={() => act(t.id, "blacklist")}
                >
                  Blacklist
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => act(t.id, "clearAiCache")}>
                Clear AI
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => act(t.id, "delete")}>
                Delete
              </Button>
            </div>
          ))}
          {tokens.length === 0 && (
            <p className="bg-panel px-4 py-8 text-center text-sm text-muted">
              Nothing here — search to find tokens, or the blacklist is empty.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Config ───────────────────────────────────────────────────── */
const KILL_LABELS: Record<string, { name: string; desc: string }> = {
  trading: { name: "Trading", desc: "Blocks all buy/sell execution and trade logging" },
  launcher: { name: "Token launcher", desc: "Blocks new launch configs + deploys" },
  ai: { name: "AI analysis", desc: "Disables the per-token AI readout" },
  ingest: { name: "Data ingest", desc: "Pauses the live pair/security pipeline" },
  lookup: { name: "CA lookup", desc: "Disables paste-a-contract search + ingest" },
  rewards: { name: "Rewards accrual", desc: "Stops points + referral qualification" },
};

/* ── Wallets (external trading wallets + cashback) ─────────────── */
const toEth = (points: number) => {
  const eth = points / 1_000_000;
  return eth === 0 ? "0" : (Math.abs(eth) >= 0.01 ? eth.toFixed(4) : eth.toFixed(6)).replace(/\.?0+$/, "");
};

function WalletsTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [wallets, setWallets] = useState<any[] | null>(null);
  const [policy, setPolicy] = useState<{
    text: string;
    defaultPoints: number;
    ethPerTradedToken: number;
    maxCashbackEth: number;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedPolicy, setSavedPolicy] = useState(false);
  const [redemptions, setRedemptions] = useState<any[] | null>(null);

  const load = useCallback(() => {
    api("/api/admin/wallets").then((d) => {
      setWallets(d.wallets);
      setPolicy(d.policy);
    });
    api("/api/admin/redemptions").then((d) => setRedemptions(d.requests ?? []));
  }, [api]);
  useEffect(load, [load]);

  const resolveRedemption = useCallback(
    async (id: string, action: "paid" | "reject") => {
      if (action === "paid" && !window.confirm("Confirm you have SENT the ETH to the user's wallet?")) return;
      const note = action === "reject" ? (window.prompt("Reason (shown in audit):", "") ?? "") : "";
      setBusy(id);
      try {
        await api("/api/admin/redemptions", { method: "POST", body: JSON.stringify({ id, action, note }) });
        load();
      } finally {
        setBusy(null);
      }
    },
    [api, load],
  );

  // formula suggestion: distinct tokens traded × ETH-per-token, capped
  const suggestEth = useCallback(
    (w: any) => {
      const traded = Number(w?.activity?.tradedCount ?? 0);
      const per = policy?.ethPerTradedToken ?? 0;
      const cap = policy?.maxCashbackEth ?? 0;
      return Math.min(traded * per, cap || Infinity);
    },
    [policy],
  );

  const grant = useCallback(
    async (id: string, current: number, suggestion: number) => {
      const input = window.prompt(
        "Cashback to award this wallet (ETH):",
        current > 0 ? toEth(current) : suggestion > 0 ? suggestion.toFixed(6).replace(/\.?0+$/, "") : "0",
      );
      if (input === null) return;
      const cashbackEth = Number(input);
      if (!Number.isFinite(cashbackEth) || cashbackEth < 0) return;
      const note = window.prompt("Note (why — e.g. 'traded 32 memecoins'):", "") ?? "";
      setBusy(id);
      try {
        await api("/api/admin/wallets", { method: "POST", body: JSON.stringify({ id, cashbackEth, note }) });
        load();
      } finally {
        setBusy(null);
      }
    },
    [api, load],
  );

  const savePolicy = useCallback(async () => {
    if (!policy) return;
    setBusy("policy");
    try {
      await api("/api/admin/wallets", { method: "POST", body: JSON.stringify({ policy }) });
      setSavedPolicy(true);
      setTimeout(() => setSavedPolicy(false), 1500);
    } finally {
      setBusy(null);
    }
  }, [api, policy]);

  return (
    <div className="flex flex-col gap-6">
      {/* redemption queue — you pay, then mark paid */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">
            Redemption requests
            {redemptions ? ` (${redemptions.filter((r: any) => r.status === "PENDING").length} pending)` : ""}
          </span>
        </div>
        {redemptions === null ? (
          <Skeleton className="m-4 h-16" />
        ) : redemptions.length === 0 ? (
          <p className="bg-panel px-4 py-6 text-center text-sm text-muted">No redemption requests.</p>
        ) : (
          <div className="overflow-x-auto">
            {redemptions.map((r: any) => (
              <div key={r.id} className="flex min-w-[680px] items-center gap-4 border-b border-line bg-panel px-4 py-3 last:border-0">
                <Badge variant={r.status === "PENDING" ? "warn" : r.status === "PAID" ? "gain" : "loss"}>
                  {r.status}
                </Badge>
                <span className="font-mono text-data tabular text-amber">{toEth(r.points)} ETH</span>
                <span className="font-mono text-data-sm text-bone">{r.wallet}</span>
                <span className="text-sm text-muted">{r.userEmail ?? "unknown"}</span>
                {r.feeTxHash ? (
                  <a
                    href={`https://etherscan.io/tx/${r.feeTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-data-sm text-faint underline underline-offset-4"
                  >
                    fee tx
                  </a>
                ) : null}
                {r.status === "PENDING" ? (
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" onClick={() => resolveRedemption(r.id, "paid")} disabled={busy === r.id}>
                      Mark paid
                    </Button>
                    <Button size="sm" variant="ghost" className="text-loss hover:text-loss" onClick={() => resolveRedemption(r.id, "reject")} disabled={busy === r.id}>
                      Reject
                    </Button>
                  </span>
                ) : (
                  <span className="ml-auto font-mono text-data-sm text-faint">
                    {new Date(r.paidAt ?? r.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* policy — what determines cashback */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Cashback policy — what determines the reward</span>
        </div>
        <div className="flex flex-col gap-3 bg-panel px-4 py-4">
          <textarea
            value={policy?.text ?? ""}
            onChange={(e) => setPolicy((p) => (p ? { ...p, text: e.target.value } : p))}
            rows={3}
            className="w-full rounded border border-line bg-raised px-3 py-2 text-sm text-bone outline-none focus:border-amber"
            placeholder="Describe what earns cashback (shown to users on the rewards page)…"
          />
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block font-mono text-data-sm text-muted">
                ETH per token traded
              </label>
              <Input
                value={policy?.ethPerTradedToken ?? 0}
                onChange={(e) =>
                  setPolicy((p) =>
                    p ? { ...p, ethPerTradedToken: e.target.value.replace(/[^0-9.]/g, "") as never } : p,
                  )
                }
                inputMode="decimal"
                className="w-32 font-mono text-data"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-data-sm text-muted">
                Max cashback (ETH)
              </label>
              <Input
                value={policy?.maxCashbackEth ?? 0}
                onChange={(e) =>
                  setPolicy((p) =>
                    p ? { ...p, maxCashbackEth: e.target.value.replace(/[^0-9.]/g, "") as never } : p,
                  )
                }
                inputMode="decimal"
                className="w-32 font-mono text-data"
              />
            </div>
            <Button size="sm" onClick={savePolicy} disabled={busy === "policy"}>
              {savedPolicy ? "Saved" : "Save policy"}
            </Button>
          </div>
          <p className="text-xs text-muted">
            Suggested = tokens traded × rate, capped.
          </p>
        </div>
      </section>

      {/* connected wallets */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Connected trading wallets</span>
        </div>
        {wallets === null ? (
          <Skeleton className="m-4 h-24" />
        ) : wallets.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">None connected.</p>
        ) : (
          <div className="overflow-x-auto">
            {wallets.map((w) => {
              const suggestion = suggestEth(w);
              const topSymbols = (w.activity?.tokens ?? [])
                .slice(0, 6)
                .map((t: { symbol: string }) => t.symbol)
                .join(", ");
              return (
                <div key={w.id} className="border-b border-line bg-panel last:border-0">
                  <div className="flex min-w-[640px] items-center gap-4 px-4 py-3">
                    <span className="font-mono text-data-sm text-bone">{w.address}</span>
                    <Badge variant={w.verified ? "gain" : "warn"}>{w.verified ? "Verified" : "Unverified"}</Badge>
                    <span className="text-sm text-muted">{w.userEmail ?? "unknown"}</span>
                    <span className="ml-auto font-mono text-data tabular text-gain">
                      {w.cashbackPoints > 0 ? `+${toEth(w.cashbackPoints)} ETH` : "—"}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => grant(w.id, w.cashbackPoints, suggestion)}
                      disabled={busy === w.id}
                    >
                      Set cashback
                    </Button>
                  </div>
                  <div className="flex min-w-[640px] flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 font-mono text-data-sm text-muted">
                    {w.activity ? (
                      <>
                        <span>{w.activity.tradedCount} tokens traded</span>
                        <span>{w.activity.holdingCount} held</span>
                        {topSymbols ? <span className="text-faint">{topSymbols}</span> : null}
                        {suggestion > 0 ? (
                          <span className="text-amber">
                            suggested {suggestion.toFixed(6).replace(/\.?0+$/, "")} ETH
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-faint">no activity scan (connected before scanning existed — ask the user to reconnect)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Developers & ads ─────────────────────────────────────────── */
function DevsTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [atChain, setAtChain] = useState("BASE");
  const [atToken, setAtToken] = useState("");
  const [atWallet, setAtWallet] = useState("");
  const [atNote, setAtNote] = useState("");
  const [atErr, setAtErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api("/api/admin/dev").then(setData).catch(() => setData({ listings: [], campaigns: [], revenue: {} }));
  }, [api]);
  useEffect(load, [load]);

  const act = async (kind: string, id: string, action: string) => {
    const note = action === "reject" ? (window.prompt("Reason (audited):", "") ?? "") : "";
    setBusy(id);
    try {
      await api("/api/admin/dev", { method: "POST", body: JSON.stringify({ kind, id, action, note }) });
      load();
    } finally {
      setBusy(null);
    }
  };

  /* Attribute a token to a wallet that did not deploy it. */
  const attribute = async () => {
    setAtErr(null);
    setBusy("attr");
    try {
      await api("/api/admin/dev", {
        method: "POST",
        body: JSON.stringify({
          kind: "attribution",
          action: "set",
          chain: atChain,
          tokenAddress: atToken,
          wallet: atWallet,
          note: atNote,
        }),
      });
      setAtToken("");
      setAtWallet("");
      setAtNote("");
      load();
    } catch (e) {
      setAtErr((e as Error).message || "Failed.");
    } finally {
      setBusy(null);
    }
  };

  const removeAttribution = async (id: string) => {
    setBusy(id);
    try {
      await api("/api/admin/dev", { method: "POST", body: JSON.stringify({ kind: "attribution", action: "remove", id }) });
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Skeleton className="h-64 rounded-md" />;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        <StatCard label="Listings" value={data.listings?.length ?? 0} />
        <StatCard label="Listing revenue" value={`${(data.revenue?.listingsEth ?? 0).toFixed(4)} ETH`} />
        <StatCard label="Ad campaigns" value={data.campaigns?.length ?? 0} />
        <StatCard label="Ad revenue" value={`${(data.revenue?.adsEth ?? 0).toFixed(4)} ETH`} />
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Dev wallet attribution</span>
        </div>
        <div className="grid gap-3 border-b border-line bg-panel px-4 py-4 sm:grid-cols-[120px_1fr_1fr_auto]">
          <select
            value={atChain}
            onChange={(e) => setAtChain(e.target.value)}
            className="h-10 rounded border border-line bg-raised px-3 font-mono text-data text-bone outline-none focus:border-amber"
          >
            <option>ETH</option>
            <option>BSC</option>
            <option>BASE</option>
            <option>RH</option>
          </select>
          <Input
            value={atToken}
            onChange={(e) => setAtToken(e.target.value.trim())}
            placeholder="token contract 0x…"
            className="font-mono text-data-sm"
          />
          <Input
            value={atWallet}
            onChange={(e) => setAtWallet(e.target.value.trim())}
            placeholder="dev wallet 0x…"
            className="font-mono text-data-sm"
          />
          <Button onClick={attribute} disabled={busy === "attr" || !atToken || !atWallet}>
            {busy === "attr" ? "…" : "Attribute"}
          </Button>
          <Input
            value={atNote}
            onChange={(e) => setAtNote(e.target.value)}
            placeholder="note (optional, audited)"
            className="text-sm sm:col-span-4"
          />
        </div>
        {atErr ? <p className="border-b border-line bg-panel px-4 py-2.5 font-mono text-data-sm text-loss">{atErr}</p> : null}
        {(data.attributions ?? []).length === 0 ? (
          <p className="bg-panel px-4 py-6 text-center text-sm text-muted">No attributions.</p>
        ) : (
          (data.attributions ?? []).map((a: any) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-3 last:border-0">
              <Badge variant="bone">{a.chain}</Badge>
              <span className="font-mono text-data-sm text-bone">{a.tokenAddress.slice(0, 10)}…{a.tokenAddress.slice(-6)}</span>
              <span className="font-mono text-data-sm text-faint">→</span>
              <span className="font-mono text-data-sm text-amber">{a.wallet.slice(0, 10)}…{a.wallet.slice(-6)}</span>
              {a.note ? <span className="text-xs text-muted">{a.note}</span> : null}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => removeAttribution(a.id)}
                disabled={busy === a.id}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Developer listings</span>
        </div>
        {(data.listings ?? []).length === 0 ? (
          <p className="bg-panel px-4 py-6 text-center text-sm text-muted">No listings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            {data.listings.map((l: any) => (
              <div key={l.id} className="flex min-w-[720px] items-center gap-3 border-b border-line bg-panel px-4 py-3 last:border-0">
                <Badge variant={l.status === "LISTED" ? "gain" : l.status === "REJECTED" ? "loss" : "warn"}>{l.status}</Badge>
                <span className="text-sm font-medium text-bone">{l.symbol ?? "—"}</span>
                <span className="font-mono text-data-sm text-faint">{l.chain}</span>
                <span className="font-mono text-data-sm text-muted">{String(l.tokenAddress).slice(0, 10)}…</span>
                <span className="font-mono text-data-sm text-amber">{l.feeEth} ETH</span>
                <span className="text-xs text-muted">{l.email ?? l.wallet?.slice(0, 10)}</span>
                <span className="ml-auto flex gap-2">
                  {l.status !== "LISTED" ? (
                    <Button size="sm" onClick={() => act("listing", l.id, "approve")} disabled={busy === l.id}>Approve</Button>
                  ) : null}
                  {l.status !== "REJECTED" ? (
                    <Button size="sm" variant="ghost" className="text-loss hover:text-loss" onClick={() => act("listing", l.id, "reject")} disabled={busy === l.id}>Reject</Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Ad campaigns</span>
        </div>
        {(data.campaigns ?? []).length === 0 ? (
          <p className="bg-panel px-4 py-6 text-center text-sm text-muted">No campaigns yet.</p>
        ) : (
          <div className="overflow-x-auto">
            {data.campaigns.map((c: any) => (
              <div key={c.id} className="flex min-w-[720px] items-center gap-3 border-b border-line bg-panel px-4 py-3 last:border-0">
                <Badge variant={c.status === "ACTIVE" ? "gain" : c.status === "REJECTED" ? "loss" : "neutral"}>{c.status}</Badge>
                <span className="text-sm font-medium text-bone">{c.symbol}</span>
                <span className="font-mono text-data-sm text-faint">{c.chain}</span>
                <span className="font-mono text-data-sm text-amber">{c.feeEth?.toFixed?.(4) ?? c.feeEth} ETH · {c.days}d</span>
                <span className="font-mono text-data-sm text-muted">{c.impressions} views · {c.clicks} clicks</span>
                {c.headline ? <span className="hidden text-xs text-muted lg:inline">{c.headline}</span> : null}
                <span className="ml-auto flex gap-2">
                  {c.status === "ACTIVE" ? (
                    <Button size="sm" variant="ghost" onClick={() => act("ad", c.id, "pause")} disabled={busy === c.id}>Pause</Button>
                  ) : c.status === "ENDED" ? (
                    <Button size="sm" variant="secondary" onClick={() => act("ad", c.id, "resume")} disabled={busy === c.id}>Resume</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="text-loss hover:text-loss" onClick={() => act("ad", c.id, "reject")} disabled={busy === c.id}>Reject</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── PnL card generator ───────────────────────────────────────── */
function PnlGeneratorTab() {
  const [symbol, setSymbol] = useState("PEPE");
  const [chain, setChain] = useState("ETH");
  const [invested, setInvested] = useState("100");
  const [current, setCurrent] = useState("150");
  const [score, setScore] = useState("82");
  const [card, setCard] = useState<PnlPosition | null>(null);

  /*
    Two numbers drive the whole card: what went in, and what it's worth now.
    PnL and ROI fall out of those — there is no entry price or live price
    anywhere, because a shared card is about the outcome, not the fill.
  */
  const num = (v: string) => Number(v.replace(/[^0-9.]/g, "")) || 0;
  const inv = num(invested);
  const cur = num(current);
  const pnl = cur - inv;
  const roi = inv > 0 ? (pnl / inv) * 100 : 0;

  const generate = () => {
    setCard({
      symbol: symbol.toUpperCase().slice(0, 12) || "TOKEN",
      chain,
      investedUsd: inv,
      valueUsd: cur,
      unrealizedPnlUsd: pnl,
      realizedPnlUsd: 0,
      score: Math.max(0, Math.min(100, Math.round(num(score)))),
    });
  };

  const Field = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-label">{label}</label>
      <Input value={value} onChange={(ev) => onChange(ev.target.value)} placeholder={placeholder} className="font-mono text-data" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Generate a PnL card</span>
        </div>
        <div className="grid gap-4 bg-panel px-4 py-4 sm:grid-cols-3">
          <Field label="Invested ($)" value={invested} onChange={setInvested} placeholder="100" />
          <Field label="Current position ($)" value={current} onChange={setCurrent} placeholder="150" />
          <Field label="Token symbol" value={symbol} onChange={setSymbol} placeholder="PEPE" />
          <div className="flex flex-col gap-1.5">
            <label className="text-label">Chain</label>
            <select
              value={chain}
              onChange={(ev) => setChain(ev.target.value)}
              className="h-10 rounded border border-line bg-raised px-3 font-mono text-data text-bone outline-none focus:border-amber"
            >
              <option>ETH</option>
              <option>BSC</option>
              <option>BASE</option>
              <option>RH</option>
            </select>
          </div>
          <Field label="Signal score" value={score} onChange={setScore} placeholder="82" />
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line bg-panel px-4 py-3">
          <span className={cn("font-mono text-data-lg tabular", pnl >= 0 ? "text-gain" : "text-loss")}>
            {roi >= 0 ? "+" : "−"}{Math.abs(roi).toFixed(2)}%
          </span>
          <span className={cn("font-mono text-data", pnl >= 0 ? "text-gain" : "text-loss")}>
            {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <Button className="ml-auto" onClick={generate}>
            Generate card
          </Button>
        </div>
      </section>

      {card ? <PnlCard position={card} onClose={() => setCard(null)} /> : null}
    </div>
  );
}

/* ── Demo (paper) trading ─────────────────────────────────────── */
function DemoTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [state, setState] = useState<any>(null);
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    api("/api/admin/demo").then((d) => {
      setState(d);
      setCash(String(d.cashUsd || ""));
    });
  }, [api]);
  useEffect(load, [load]);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      try {
        const d = await api("/api/admin/demo", { method: "POST", body: JSON.stringify(patch) });
        setState(d);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  if (!state) return <Skeleton className="h-48 rounded-md" />;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="overflow-hidden rounded-md border border-line">
        <label className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3.5">
          <span>
            <span className="block text-sm text-bone">
              Demo trading {state.enabled ? "— ON" : "— off"}
            </span>
            <span className="block text-xs text-muted">
              Simulated trades against a cash balance at live prices. Gains/losses track the
              coin, no real money moves. Trade &amp; portfolio look identical.
            </span>
          </span>
          <Switch checked={state.enabled === true} onCheckedChange={(v) => save({ enabled: v })} />
        </label>
        <div className="flex items-end gap-3 bg-panel px-4 py-4">
          <div className="flex-1">
            <p className="text-label mb-1">Balance (USD)</p>
            <Input
              value={cash}
              onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="10000"
              className="font-mono text-data"
            />
            <p className="mt-1 text-xs text-muted">
              Setting a balance resets demo cash and clears simulated positions.
            </p>
          </div>
          <Button onClick={() => save({ cashUsd: Number(cash) || 0 })} disabled={busy}>
            {saved ? "Saved" : "Set balance"}
          </Button>
        </div>
        <div className="flex items-center justify-between bg-panel px-4 py-3">
          <span className="font-mono text-data-sm text-muted">
            Current demo cash: ${Number(state.cashUsd || 0).toLocaleString()}
          </span>
          <Button size="sm" variant="ghost" onClick={() => save({ reset: true })} disabled={busy}>
            Reset positions
          </Button>
        </div>
      </section>
    </div>
  );
}

function ConfigTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [config, setConfigState] = useState<any>(null);
  const [rewardsEth, setRewardsEth] = useState<Record<string, string>>({});
  const [feePct, setFeePct] = useState("0"); // swap fee as a % string while editing
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api("/api/admin/config").then((d) => {
      setConfigState(d);
      // reward amounts are stored in µETH points — edit them as ETH
      setRewardsEth(
        Object.fromEntries(
          Object.entries(d.rewards ?? {}).map(([k, v]) => [k, toEth(Number(v))]),
        ),
      );
      setFeePct(String((d.monetization?.swapFeeBps ?? 0) / 100));
    });
  }, [api]);

  if (!config) return <Skeleton className="h-64 rounded-md" />;

  const save = async () => {
    const rewards = Object.fromEntries(
      Object.entries(rewardsEth).map(([k, v]) => [k, Math.round((Number(v) || 0) * 1_000_000)]),
    );
    // fee fields are edited as raw text (so "0.002" can be typed) and coerced
    // to numbers here, at save time
    const m = config.monetization ?? {};
    const n = (v: unknown, fb = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : fb;
    };
    const monetization = {
      ...m,
      swapFeeBps: Math.round(n(feePct) * 100),
      launchFeeEth: n(m.launchFeeEth),
      launchFeeBnb: n(m.launchFeeBnb),
      redemptionFeeEth: n(m.redemptionFeeEth),
      devListingFeeEth: n(m.devListingFeeEth),
      devListingFeeSol: n(m.devListingFeeSol),
      adFeePerDayEth: n(m.adFeePerDayEth),
      adSlots: Math.max(1, Math.round(n(m.adSlots, 3))),
      feeTolerancePct: n(m.feeTolerancePct, 5),
      feeWalletSol: String(m.feeWalletSol ?? "").trim(),
    };
    const d = await api("/api/admin/config", {
      method: "POST",
      body: JSON.stringify({
        killSwitches: config.killSwitches,
        rewards,
        rewardSwitches: config.rewardSwitches,
        announcement: config.announcement,
        launchBanner: config.launchBanner ?? { enabled: true },
        monetization,
        channelCalls: {
          ...ch,
          minMcapUsd: Math.round(n(ch.minMcapUsd, 8000)),
          maxMcapUsd: Math.round(n(ch.maxMcapUsd, 1000000)),
          minVolume24hUsd: Math.round(n(ch.minVolume24hUsd, 5000)),
          minLiquidityUsd: Math.round(n(ch.minLiquidityUsd, 4000)),
          minPriceChangePct: n(ch.minPriceChangePct, -20),
          maxMcapLiqRatio: n(ch.maxMcapLiqRatio, 5),
          minPairAgeMins: Math.round(n(ch.minPairAgeMins, 30)),
          maxPairAgeDays: Math.round(n(ch.maxPairAgeDays, 30)),
          maxSellBuyRatio5m: n(ch.maxSellBuyRatio5m, 1.5),
          maxVolLiqRatio24h: n(ch.maxVolLiqRatio24h, 50),
          minTxns5mTotal: Math.round(n(ch.minTxns5mTotal, 5)),
          minScore: Math.round(n(ch.minScore, 50)),
          postIntervalMinMins: Math.round(n(ch.postIntervalMinMins, 5)),
          postIntervalMaxMins: Math.round(n(ch.postIntervalMaxMins, 15)),
          retireDropPct: n(ch.retireDropPct, 50),
          retireLiqPct: n(ch.retireLiqPct, 30),
          milestones: String(ch.milestones ?? "")
            .split(",")
            .map((x: string) => Number(x.trim()))
            .filter((x: number) => Number.isFinite(x) && x >= 2),
        },
      }),
    });
    setConfigState(d);
    setRewardsEth(
      Object.fromEntries(Object.entries(d.rewards ?? {}).map(([k, v]) => [k, toEth(Number(v))])),
    );
    setFeePct(String((d.monetization?.swapFeeBps ?? 0) / 100));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const mon = config.monetization ?? { swapFeeBps: 0, feeWallet: "", launchFeeEth: 0, launchFeeBnb: 0 };
  const setMon = (patch: Record<string, unknown>) =>
    setConfigState({ ...config, monetization: { ...mon, ...patch } });

  const ch = config.channelCalls ?? {};
  const setCh = (patch: Record<string, unknown>) =>
    setConfigState({ ...config, channelCalls: { ...ch, ...patch } });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center justify-between gap-4 bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Solana launch modal</span>
            <span className="block text-xs text-muted">
              Shown once per person on sign-in. Turn off to retire it for everyone.
            </span>
          </span>
          <Switch
            checked={config.launchBanner?.enabled !== false}
            onCheckedChange={(v) => setConfigState({ ...config, launchBanner: { enabled: v } })}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Site announcement</span>
          <Switch
            checked={config.announcement?.enabled === true}
            onCheckedChange={(v) =>
              setConfigState({
                ...config,
                announcement: { ...(config.announcement ?? { text: "" }), enabled: v },
              })
            }
          />
        </div>
        <div className="px-4 py-3.5">
          <Input
            value={config.announcement?.text ?? ""}
            onChange={(e) =>
              setConfigState({
                ...config,
                announcement: { ...(config.announcement ?? { enabled: false }), text: e.target.value },
              })
            }
            placeholder="Shown as a banner across the whole site…"
            maxLength={200}
          />
          <p className="mt-2 text-xs text-muted">
            Appears at the top of every page when enabled. Max 200 characters.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Kill switches</span>
        </div>
        {Object.entries(KILL_LABELS).map(([key, meta]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3.5 last:border-0"
          >
            <span>
              <span className={cn("block text-sm", config.killSwitches[key] ? "text-loss" : "text-bone")}>
                {meta.name}
                {config.killSwitches[key] ? " — KILLED" : ""}
              </span>
              <span className="block text-xs text-muted">{meta.desc}</span>
            </span>
            <Switch
              checked={config.killSwitches[key] === true}
              onCheckedChange={(v) =>
                setConfigState({ ...config, killSwitches: { ...config.killSwitches, [key]: v } })
              }
            />
          </label>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Reward amounts (ETH)</span>
        </div>
        {(
          [
            ["referralQualified", "Referral qualified (to referrer)"],
            ["firstTrade", "First trade"],
            ["launch", "Each launch"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3 last:border-0">
            <span className="text-sm text-bone">{label}</span>
            <div className="flex items-center gap-2">
              <Input
                value={rewardsEth[key] ?? ""}
                onChange={(e) =>
                  setRewardsEth({ ...rewardsEth, [key]: e.target.value.replace(/[^0-9.]/g, "") })
                }
                inputMode="decimal"
                className="w-28 text-right font-mono text-data"
              />
              <span className="font-mono text-data-sm text-muted">ETH</span>
            </div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Reward switches</span>
        </div>
        {(
          [
            ["referral", "Referral rewards", "Referrer earns when a referred account qualifies"],
            ["firstTrade", "First-trade bonus", "One-time reward on a user's first trade"],
            ["launch", "Launch reward", "Earned on each token launch"],
            ["tradeCashback", "Trading cashback", "Volume-based ETH back on every trade"],
            ["walletCashback", "Wallet cashback", "Connect-a-trading-wallet program (rewards page)"],
          ] as const
        ).map(([key, name, desc]) => (
          <label
            key={key}
            className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3.5 last:border-0"
          >
            <span>
              <span className={cn("block text-sm", config.rewardSwitches?.[key] === false ? "text-loss" : "text-bone")}>
                {name}
                {config.rewardSwitches?.[key] === false ? " — OFF" : ""}
              </span>
              <span className="block text-xs text-muted">{desc}</span>
            </span>
            <Switch
              checked={config.rewardSwitches?.[key] !== false}
              onCheckedChange={(v) =>
                setConfigState({
                  ...config,
                  rewardSwitches: { ...(config.rewardSwitches ?? {}), [key]: v },
                })
              }
            />
          </label>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Monetization — platform fees</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Swap fee (%)</span>
            <span className="block text-xs text-muted">Taken on every buy/sell, shown to users. Max 5%.</span>
          </span>
          <Input
            value={feePct}
            onChange={(e) => setFeePct(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="border-b border-line bg-panel px-4 py-3">
          <span className="block text-sm text-bone">Fee wallet · Solana</span>
          <Input
            value={mon.feeWalletSol ?? ""}
            onChange={(e) => setMon({ feeWalletSol: e.target.value.trim() })}
            placeholder="base58 — Solana fees are off until this is set"
            className="mt-2 w-full font-mono text-data-sm"
          />
        </div>
        <div className="border-b border-line bg-panel px-4 py-3">
          <span className="block text-sm text-bone">Fee wallet (receives fees)</span>
          <Input
            value={mon.feeWallet}
            onChange={(e) => setMon({ feeWallet: e.target.value.trim() })}
            placeholder="0x… — fees are off until a valid address is set"
            className="mt-2 w-full font-mono text-data-sm"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Launch fee · Ethereum (ETH)</span>
          <Input
            value={mon.launchFeeEth}
            onChange={(e) => setMon({ launchFeeEth: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Launch fee · BNB Chain (BNB)</span>
          <Input
            value={mon.launchFeeBnb}
            onChange={(e) => setMon({ launchFeeBnb: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Dev listing fee (ETH)</span>
            <span className="block text-xs text-muted">Charged when a developer lists a token we don&apos;t index yet</span>
          </span>
          <Input
            value={mon.devListingFeeEth ?? ""}
            onChange={(e) => setMon({ devListingFeeEth: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Dev listing fee (SOL)</span>
            <span className="block text-xs text-muted">The same listing fee on Solana, priced in SOL</span>
          </span>
          <Input
            value={mon.devListingFeeSol ?? ""}
            onChange={(e) => setMon({ devListingFeeSol: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Ad slot fee (ETH / day)</span>
            <span className="block text-xs text-muted">Promoted banner across the screener + token pages</span>
          </span>
          <Input
            value={mon.adFeePerDayEth ?? ""}
            onChange={(e) => setMon({ adFeePerDayEth: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Ad slots in rotation</span>
            <span className="block text-xs text-muted">How many promoted tokens rotate at once</span>
          </span>
          <Input
            value={mon.adSlots ?? ""}
            onChange={(e) => setMon({ adSlots: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Fee tolerance (%)</span>
            <span className="block text-xs text-muted">
              How far under the fee a payment may land and still count — a swapped fee arrives at whatever the pool gave
            </span>
          </span>
          <Input
            value={mon.feeTolerancePct ?? ""}
            onChange={(e) => setMon({ feeTolerancePct: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Redemption fee (ETH)</span>
            <span className="block text-xs text-muted">Paid by users to redeem rewards to a wallet</span>
          </span>
          <Input
            value={mon.redemptionFeeEth ?? ""}
            onChange={(e) => setMon({ redemptionFeeEth: e.target.value.replace(/[^0-9.]/g, "") })}
            inputMode="decimal"
            className="w-24 text-right font-mono text-data"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Channel calls</span>
          <Switch checked={ch.enabled === true} onCheckedChange={(v) => setCh({ enabled: v })} />
        </div>
        <div className="border-b border-line bg-panel px-4 py-3">
          <span className="block text-sm text-bone">Channel</span>
          <span className="block text-xs text-muted">@handle or -100… id. The bot must be an admin there.</span>
          <Input
            value={ch.chatId ?? ""}
            onChange={(e) => setCh({ chatId: e.target.value.trim() })}
            placeholder="@quantai_calls"
            className="mt-2 w-full font-mono text-data-sm"
          />
          {config.channelDetected?.chatId ? (
            <button
              onClick={() => setCh({ chatId: config.channelDetected.chatId })}
              className="mt-2 text-left font-mono text-data-sm text-amber hover:underline"
            >
              use detected: {config.channelDetected.chatId}
              {config.channelDetected.title ? ` · ${config.channelDetected.title}` : ""}
              {config.channelDetected.status ? ` (${config.channelDetected.status})` : ""}
            </button>
          ) : (
            <span className="mt-2 block text-xs text-faint">
              Add the bot to the channel and its real id appears here.
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Min market cap ($)</span>
          <Input
            value={ch.minMcapUsd ?? ""}
            onChange={(e) => setCh({ minMcapUsd: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Max market cap ($)</span>
            <span className="block text-xs text-muted">Small-cap bias — bigger caps are skipped</span>
          </span>
          <Input
            value={ch.maxMcapUsd ?? ""}
            onChange={(e) => setCh({ maxMcapUsd: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Min 24h volume ($)</span>
          <Input
            value={ch.minVolume24hUsd ?? ""}
            onChange={(e) => setCh({ minVolume24hUsd: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Min liquidity ($)</span>
          <Input
            value={ch.minLiquidityUsd ?? ""}
            onChange={(e) => setCh({ minLiquidityUsd: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Min 6h / 24h change (%)</span>
            <span className="block text-xs text-muted">Both must be above this. Negative allowed.</span>
          </span>
          <Input
            value={ch.minPriceChangePct ?? ""}
            onChange={(e) => setCh({ minPriceChangePct: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Max mcap ÷ liquidity</span>
            <span className="block text-xs text-muted">Cap can't run this far ahead of its pool</span>
          </span>
          <Input
            value={ch.maxMcapLiqRatio ?? ""}
            onChange={(e) => setCh({ maxMcapLiqRatio: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Min pair age (minutes)</span>
            <span className="block text-xs text-muted">Rejects sniper bait</span>
          </span>
          <Input
            value={ch.minPairAgeMins ?? ""}
            onChange={(e) => setCh({ minPairAgeMins: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Max pair age (days)</span>
            <span className="block text-xs text-muted">Rejects stale listings</span>
          </span>
          <Input
            value={ch.maxPairAgeDays ?? ""}
            onChange={(e) => setCh({ maxPairAgeDays: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Max 5m sells ÷ buys</span>
            <span className="block text-xs text-muted">Rejects an active sell-off</span>
          </span>
          <Input
            value={ch.maxSellBuyRatio5m ?? ""}
            onChange={(e) => setCh({ maxSellBuyRatio5m: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Max 24h vol ÷ liquidity</span>
            <span className="block text-xs text-muted">Rejects obvious wash trading</span>
          </span>
          <Input
            value={ch.maxVolLiqRatio24h ?? ""}
            onChange={(e) => setCh({ maxVolLiqRatio24h: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Min 5m transactions</span>
            <span className="block text-xs text-muted">Requires recent real activity</span>
          </span>
          <Input
            value={ch.minTxns5mTotal ?? ""}
            onChange={(e) => setCh({ minTxns5mTotal: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Min score (0 = off)</span>
            <span className="block text-xs text-muted">The card prints 评分, so a floor avoids advertising a weak one</span>
          </span>
          <Input
            value={ch.minScore ?? ""}
            onChange={(e) => setCh({ minScore: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span className="text-sm text-bone">Post gap · min (minutes)</span>
          <Input
            value={ch.postIntervalMinMins ?? ""}
            onChange={(e) => setCh({ postIntervalMinMins: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Post gap · max (minutes)</span>
            <span className="block text-xs text-muted">Gap is random between min and max</span>
          </span>
          <Input
            value={ch.postIntervalMaxMins ?? ""}
            onChange={(e) => setCh({ postIntervalMaxMins: e.target.value.replace(/[^0-9]/g, "") })}
            inputMode="numeric"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Retire on drop (%)</span>
            <span className="block text-xs text-muted">Stop tracking below this — never posted</span>
          </span>
          <Input
            value={ch.retireDropPct ?? ""}
            onChange={(e) => setCh({ retireDropPct: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Retire on liquidity left (%)</span>
            <span className="block text-xs text-muted">Of the pool it had at call time</span>
          </span>
          <Input
            value={ch.retireLiqPct ?? ""}
            onChange={(e) => setCh({ retireLiqPct: e.target.value.replace(/[^0-9.-]/g, "") })}
            inputMode="decimal"
            className="w-28 text-right font-mono text-data"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
          <span>
            <span className="block text-sm text-bone">Require a Telegram link</span>
            <span className="block text-xs text-muted">No community, no call</span>
          </span>
          <Switch checked={ch.requireTelegram !== false} onCheckedChange={(v) => setCh({ requireTelegram: v })} />
        </div>
        <div className="border-b border-line bg-panel px-4 py-3">
          <span className="block text-sm text-bone">Gain milestones</span>
          <span className="block text-xs text-muted">Multiples that earn a threaded reply. Gains only.</span>
          <Input
            value={Array.isArray(ch.milestones) ? ch.milestones.join(",") : (ch.milestones ?? "")}
            onChange={(e) => setCh({ milestones: e.target.value.replace(/[^0-9,]/g, "") })}
            placeholder="2,3,5,10,25,50,100"
            className="mt-2 w-full font-mono text-data-sm"
          />
        </div>
        <div className="border-b border-line bg-panel px-4 py-3">
          <span className="block text-sm text-bone">House ad banner</span>
          <span className="block text-xs text-muted">Shown when no paid campaign is live</span>
          <Input
            value={ch.adText ?? ""}
            onChange={(e) => setCh({ adText: e.target.value })}
            placeholder="广告位招租？联系我们"
            className="mt-2 w-full text-sm"
          />
          <Input
            value={ch.adUrl ?? ""}
            onChange={(e) => setCh({ adUrl: e.target.value.trim() })}
            placeholder="https://…"
            className="mt-2 w-full font-mono text-data-sm"
          />
        </div>
        <div className="bg-panel px-4 py-3">
          <ChannelPreview api={api} />
        </div>
      </section>

      <div>
        <Button onClick={save}>{saved ? "Saved" : "Save config"}</Button>
      </div>
    </div>
  );
}

/* ── Channel call preview ─────────────────────────────────────── */
/*
  Renders a real token as the channel would post it, so the desk can check the
  card before switching calls on. "Send test" posts it for real, which also
  proves the bot can write to the channel.
*/
function ChannelPreview({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [chain, setChain] = useState("eth");
  const [address, setAddress] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: "preview" | "test") => {
    setErr(null);
    setBusy(action);
    try {
      const d = await api("/api/admin/channel", {
        method: "POST",
        body: JSON.stringify({ action, chain, address }),
      });
      setText(d.text ?? null);
      if (action === "test" && d.posted) setErr(null);
    } catch (e) {
      setErr((e as Error).message || "Failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="block text-sm text-bone">Preview a call</span>
      <div className="flex flex-wrap gap-2">
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="h-9 rounded border border-line bg-raised px-2 font-mono text-data-sm text-bone outline-none focus:border-amber"
        >
          <option value="eth">Ethereum</option>
          <option value="bsc">BNB Chain</option>
          <option value="base">Base</option>
          <option value="rh">Robinhood</option>
        </select>
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder="0x…"
          className="min-w-[220px] flex-1 font-mono text-data-sm"
        />
        <Button size="sm" variant="secondary" onClick={() => run("preview")} disabled={busy !== null}>
          {busy === "preview" ? "…" : "Preview"}
        </Button>
        <Button size="sm" onClick={() => run("test")} disabled={busy !== null}>
          {busy === "test" ? "…" : "Send test"}
        </Button>
      </div>
      {err ? <p className="font-mono text-data-sm text-loss">{err}</p> : null}
      {text ? (
        <pre className="max-h-80 overflow-auto rounded border border-line bg-ink px-3 py-2 font-mono text-data-sm text-bone">
          {text.replace(/<[^>]+>/g, "")}
        </pre>
      ) : null}
    </div>
  );
}

/* ── Audit ────────────────────────────────────────────────────── */
function AuditTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [entries, setEntries] = useState<any[] | null>(null);
  useEffect(() => {
    api("/api/admin/audit").then((d) => setEntries(d.entries));
  }, [api]);

  if (entries === null) return <Skeleton className="h-48 rounded-md" />;
  if (entries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No admin actions recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      {entries.map((e) => (
        <div key={e.id} className="flex min-w-[640px] items-center gap-4 border-b border-line bg-panel px-4 py-2.5 last:border-0">
          <span className="font-mono text-data-sm text-faint"><LiveTimeAgo date={e.createdAt} /></span>
          <span className="text-sm text-bone">{e.admin?.email ?? "unknown"}</span>
          <Badge variant="bone">{e.action}</Badge>
          <span className="font-mono text-data-sm text-muted">
            {e.targetType}
            {e.targetId ? ` · ${String(e.targetId).slice(0, 12)}…` : ""}
          </span>
          <span className="ml-auto max-w-64 truncate font-mono text-data-sm text-faint">
            {e.meta ? JSON.stringify(e.meta) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}


/*
  Creator cashback — claims waiting on the desk, and the rules that price them.

  Settlement is manual on purpose: this screen records what was decided and
  what was sent, and never moves money itself. The payout address is shown in
  full, because a truncated one is useless to someone about to pay it.
*/
/*
  Liquidity wallets developers imported, and the switch that decides whether
  the import panel exists for them at all.

  This is the only screen in the product that displays other people's private
  keys. Each one is a live spending credential, so they stay masked until asked
  for, and opening this tab writes an audit entry.
*/
function LiquidityTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // a handoff reference the developer sent over Telegram
  const [ref, setRef] = useState("");
  const [opened, setOpened] = useState<any | null>(null);
  const [refMsg, setRefMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    const [list, config] = await Promise.all([
      api("/api/admin/liquidity").catch(() => null),
      api("/api/admin/config").catch(() => null),
    ]);
    setRows(list?.wallets ?? []);
    if (config?.liquidityPartner) setEnabled(Boolean(config.liquidityPartner.enabled));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRef = useCallback(
    async (value: string) => {
      const clean = value.trim();
      if (!clean) return;
      setOpening(true);
      setRefMsg(null);
      setOpened(null);
      try {
        const r = await api(`/api/admin/liquidity/resolve?ref=${encodeURIComponent(clean)}`);
        setOpened(r.wallet);
        // the row's handoffUsedAt just changed, so the table below is stale
        await load();
      } catch (e: any) {
        setRefMsg(e?.message ?? "Could not open that link.");
      } finally {
        setOpening(false);
      }
    },
    [api, load],
  );

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("liquidity");
    if (q) {
      setRef(q);
      void openRef(q);
    }
  }, [openRef]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setSaved(null);
    try {
      await api("/api/admin/config", {
        method: "POST",
        body: JSON.stringify({ liquidityPartner: { enabled: next } }),
      });
      setEnabled(next);
      setSaved(next ? "Panel is live for developers." : "Panel is hidden from developers.");
    } catch (e: any) {
      setSaved(e?.message ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-panel px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-label">Liquidity partnership panel</span>
          <span className="text-sm text-muted">
            {enabled === null
              ? "Loading…"
              : enabled
                ? "Visible to every developer."
                : "Hidden. Only admins can see it."}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saved ? <span className="text-sm text-muted">{saved}</span> : null}
          <Button
            variant={enabled ? "secondary" : "primary"}
            disabled={busy || enabled === null}
            onClick={() => toggle(!enabled)}
          >
            {busy ? "Saving…" : enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">Open a handoff link</span>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <Input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Paste the reference or the full link a developer sent you"
              className="min-w-[18rem] flex-1 font-mono text-data"
            />
            <Button
              onClick={() => openRef(ref.includes("liquidity=") ? ref.split("liquidity=")[1] : ref)}
              disabled={opening || !ref.trim()}
            >
              {opening ? "Opening…" : "Open"}
            </Button>
          </div>
          {refMsg ? <p className="text-sm text-loss">{refMsg}</p> : null}
          {opened ? (
            <div className="flex flex-col gap-1.5 rounded border border-line bg-raised px-3 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-data-sm uppercase text-muted">{opened.chain}</span>
                <span className="font-mono text-data-sm text-bone">{opened.address}</span>
                <span className="font-mono text-data-sm tabular-nums text-bone">
                  {opened.balance == null ? "—" : Number(opened.balance).toFixed(4)}
                </span>
              </div>
              <span className="text-sm text-muted">
                Token: {opened.tokenAddress ?? "—"} · Developer: {opened.owner ?? "—"}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-data-sm text-loss">{opened.privateKey}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigator.clipboard?.writeText(opened.privateKey)}
                >
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-label">Imported liquidity wallets</span>
        </div>

        {rows === null ? (
          <p className="px-4 py-6 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No liquidity wallets imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left">
              <thead className="border-b border-line">
                <tr className="text-label">
                  <th className="px-4 py-2">Chain</th>
                  <th className="px-4 py-2">Wallet</th>
                  <th className="px-4 py-2">Balance</th>
                  <th className="px-4 py-2">Token</th>
                  <th className="px-4 py-2">Developer</th>
                  <th className="px-4 py-2">Private key</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-mono text-data-sm uppercase text-muted">{r.chain}</td>
                    <td className="px-4 py-3 font-mono text-data-sm text-bone">{r.address}</td>
                    <td className="px-4 py-3 font-mono text-data-sm tabular-nums text-bone">
                      {r.balance == null ? "—" : Number(r.balance).toFixed(4)}
                    </td>
                    <td className="px-4 py-3 font-mono text-data-sm text-faint">
                      {r.tokenAddress ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{r.owner ?? "—"}</td>
                    <td className="px-4 py-3">
                      {shown[r.id] ? (
                        <span className="flex items-center gap-2">
                          <code className="break-all font-mono text-data-sm text-loss">
                            {r.privateKey}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigator.clipboard?.writeText(r.privateKey)}
                          >
                            Copy
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setShown((m) => ({ ...m, [r.id]: true }))}
                        >
                          Reveal
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CashbackTab({ api }: { api: (p: string, i?: RequestInit) => Promise<any> }) {
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [filter, setFilter] = useState("PENDING");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [claims, config] = await Promise.all([
      api(`/api/admin/cashback?status=${filter}`).catch(() => null),
      api("/api/admin/config").catch(() => null),
    ]);
    if (claims) setData(claims);
    if (config?.creatorCashback) setCfg(config.creatorCashback);
  }, [api, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, status: string) => {
    setBusy(id);
    try {
      await api("/api/admin/cashback", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  /*
    Edit locally, save on the button.

    This used to PATCH on every change — a method the config route doesn't
    implement, so every keystroke got a 405 that a silent catch threw away.
    Nothing was ever written and nothing said so. Now the numbers are held here
    until Save, which reports what happened either way.
  */
  const setField = (key: string, value: unknown) => setCfg((c: any) => ({ ...c, [key]: value }));

  const save = async () => {
    setBusy("save");
    setSaved(null);
    try {
      const clean = {
        enabled: Boolean(cfg.enabled),
        minSol: num(cfg.minSol),
        maxSol: num(cfg.maxSol),
        minEth: num(cfg.minEth),
        maxEth: num(cfg.maxEth),
        minBnb: num(cfg.minBnb),
        maxBnb: num(cfg.maxBnb),
        peakFloorUsd: num(cfg.peakFloorUsd),
        peakCeilingUsd: num(cfg.peakCeilingUsd),
        minLiquidityUsd: num(cfg.minLiquidityUsd),
      };
      await api("/api/admin/config", {
        method: "POST",
        body: JSON.stringify({ creatorCashback: clean }),
      });
      // read it back, so "saved" means the server agrees rather than the browser
      const fresh = await api("/api/admin/config");
      if (fresh?.creatorCashback) setCfg(fresh.creatorCashback);
      setSaved("Saved.");
    } catch (e) {
      setSaved((e as Error).message || "Couldn't save.");
    } finally {
      setBusy(null);
    }
  };

  /*
    What's currently typed, held as text.

    Converting to a number on every keystroke made decimals impossible to
    enter: "0." parses to 0, which re-renders as "0", so the decimal point is
    deleted the moment it's typed and 0.05 can never be reached. The text is
    kept as-is while editing and turned into a number when the field is left.
  */

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* the rules */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">How cashback is scored</span>
        </div>
        {cfg === null ? (
          <Skeleton className="m-4 h-24" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3">
              <span>
                <span className="block text-sm text-bone">Creator cashback open</span>
                <span className="block text-xs text-muted">
                  Off means developers see nothing and no claim can be made
                </span>
              </span>
              <Switch checked={Boolean(cfg.enabled)} onCheckedChange={(v) => setField("enabled", v)} />
            </div>
            {[
              ["minSol", "Minimum per token (SOL)", "The least a Solana creator can receive"],
              ["maxSol", "Maximum per token (SOL)", "The most, however well the token did"],
              ["minEth", "Minimum per token (ETH)", "Ethereum, Base and Robinhood pay in ETH"],
              ["maxEth", "Maximum per token (ETH)", "The ceiling for those chains"],
              ["minBnb", "Minimum per token (BNB)", "BNB Chain creators are paid in BNB"],
              ["maxBnb", "Maximum per token (BNB)", "The ceiling for BNB Chain"],
              ["peakFloorUsd", "Peak cap for the minimum (USD)", "A token peaking at or below this earns the minimum"],
              ["peakCeilingUsd", "Peak cap for the maximum (USD)", "At or above this it earns the maximum"],
              ["minLiquidityUsd", "Minimum liquidity (USD)", "Below this a token earns nothing at all"],
            ].map(([key, label, hint]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3 last:border-b-0"
              >
                <span>
                  <span className="block text-sm text-bone">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
                <Input
                  value={String(cfg[key as string] ?? "")}
                  onChange={(e) => setField(key as string, e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="w-32 text-right font-mono text-data"
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 bg-panel px-4 py-3">
              {/* the result is stated, not assumed — a silent save is what hid
                  the last failure */}
              <span className={cn("text-sm", saved === "Saved." ? "text-gain" : "text-loss")}>
                {saved ?? ""}
              </span>
              <Button onClick={save} disabled={busy === "save"}>
                {busy === "save" ? "Saving…" : "Save cashback settings"}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* the claims */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2.5">
          <span className="text-label">Claims</span>
          <span className="flex items-center gap-3">
            {data?.owed && Object.keys(data.owed).length > 0 ? (
              <span className="font-mono text-data-sm text-amber">
                owed{" "}
                {Object.entries(data.owed)
                  .map(([asset, amount]) => `${amount} ${asset}`)
                  .join(" · ")}
              </span>
            ) : null}
            <span className="flex overflow-hidden rounded border border-line">
              {["PENDING", "APPROVED", "PAID", "ALL"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={cn(
                    "px-2.5 py-1 font-mono text-data-sm transition-colors",
                    filter === s ? "bg-raised text-amber" : "text-muted hover:text-bone",
                  )}
                >
                  {s.toLowerCase()}
                </button>
              ))}
            </span>
          </span>
        </div>

        {data === null ? (
          <Skeleton className="m-4 h-24" />
        ) : data.claims.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          data.claims.map((c: any) => (
            <div key={c.id} className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-data-sm text-bone">{c.symbol ?? "—"}</span>
                <Badge variant="neutral">{c.chain}</Badge>
                <span className="font-mono text-data text-amber">
                  {c.amountNative} {c.asset}
                </span>
                <span className="font-mono text-data-sm text-faint">
                  score {c.tokenScore} · liq ${Math.round(c.liquidityUsd).toLocaleString()} · vol $
                  {Math.round(c.volume24hUsd).toLocaleString()}
                </span>
                <Badge
                  variant={c.status === "PAID" ? "gain" : c.status === "REJECTED" ? "loss" : "neutral"}
                  className="ml-auto"
                >
                  {c.status}
                </Badge>
              </div>

              {/* the address to pay, in full */}
              <p className="break-all font-mono text-data-sm text-muted">
                pay to <span className="text-bone">{c.payoutWallet}</span>
                {c.dev?.user?.email ? <span className="text-faint"> · {c.dev.user.email}</span> : null}
              </p>

              {c.status !== "PAID" ? (
                <div className="flex flex-wrap gap-2">
                  {c.status !== "APPROVED" ? (
                    <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => decide(c.id, "APPROVED")}>
                      Approve
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={busy === c.id} onClick={() => decide(c.id, "PAID")}>
                    Mark paid
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => decide(c.id, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
