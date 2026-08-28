"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function AccountClient() {
  const {
    configured,
    ready,
    authenticated,
    email,
    walletAddress,
    solanaAddress,
    logout,
    exportWallet,
    unlinkWallet,
    wallets,
    createEmbeddedWallet,
    importWallet,
  } = useAuth();
  const router = useRouter();
  const [copied, setCopied] = useState<"evm" | "sol" | null>(null);
  const [walletBusy, setWalletBusy] = useState<null | "create" | "import">(null);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [pk, setPk] = useState("");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setActive(localStorage.getItem("quantai:activeWallet"));
  }, []);

  useEffect(() => {
    if (ready && (!configured || !authenticated)) router.replace("/signin");
  }, [ready, configured, authenticated, router]);

  if (!ready || !authenticated) {
    return <div className="h-64 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  const copy = async () => {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied("evm");
    setTimeout(() => setCopied(null), 1600);
  };

  const copySol = async () => {
    if (!solanaAddress) return;
    await navigator.clipboard.writeText(solanaAddress);
    setCopied("sol");
    setTimeout(() => setCopied(null), 1600);
  };

  const generate = async () => {
    setWalletBusy("create");
    setWalletMsg(null);
    try {
      const addr = await createEmbeddedWallet();
      setWalletMsg(addr ? `New wallet created: ${shortAddress(addr)}` : "Couldn't create a wallet.");
    } finally {
      setWalletBusy(null);
    }
  };

  const doImport = async () => {
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(pk.trim())) {
      setWalletMsg("That doesn't look like a valid private key (64 hex characters).");
      return;
    }
    setWalletBusy("import");
    setWalletMsg(null);
    try {
      const addr = await importWallet(pk.trim());
      setPk("");
      setShowImport(false);
      setWalletMsg(addr ? `Imported wallet: ${shortAddress(addr)}` : "Import failed — check the key.");
    } catch (e) {
      setWalletMsg((e as Error).message?.slice(0, 120) ?? "Import failed.");
    } finally {
      setWalletBusy(null);
    }
  };

  const setActiveWallet = (addr: string) => {
    localStorage.setItem("quantai:activeWallet", addr);
    setActive(addr);
  };

  const activeAddr = active ?? walletAddress;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-5 py-2.5">
          <span className="text-label">Profile</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">Email</p>
            <p className="text-xs text-muted">{email ?? "—"}</p>
          </div>
          <span className="font-mono text-data-sm text-faint">Used for sign-in</span>
        </div>
        {/*
          Two wallets, listed separately and never merged. The formats aren't
          interchangeable — an EVM address pasted into a Solana field simply
          fails — so each one is labelled with the chains it actually works on.
        */}
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">EVM wallet</p>
            <p className="font-mono text-data-sm text-muted" title={walletAddress ?? undefined}>
              {walletAddress ? shortAddress(walletAddress) : "Provisioning…"}
              <span className="text-faint"> · ETH + BSC + Base</span>
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={copy} disabled={!walletAddress}>
            {copied === "evm" ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">Solana wallet</p>
            <p className="font-mono text-data-sm text-muted" title={solanaAddress ?? undefined}>
              {solanaAddress ? shortAddress(solanaAddress) : "Provisioning…"}
              <span className="text-faint"> · SOL</span>
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={copySol}
            disabled={!solanaAddress}
          >
            {copied === "sol" ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">Private key</p>
            <p className="text-xs text-muted">
              Shown only to you, in an isolated dialog. Anyone with the key
              controls the wallet.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!walletAddress}
            onClick={() => exportWallet()}
          >
            Reveal key
          </Button>
        </div>
      </section>

      {/* wallets — generate, switch, import */}
      <section className="overflow-hidden rounded-md border border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-5 py-2.5">
          <span className="text-label">Wallets</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={generate} disabled={walletBusy !== null}>
              {walletBusy === "create" ? "Creating…" : "Generate wallet"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowImport((s) => !s)} disabled={walletBusy !== null}>
              Import key
            </Button>
          </div>
        </div>

        {showImport ? (
          <div className="flex flex-col gap-2 border-b border-line bg-panel px-5 py-4">
            <p className="text-xs text-muted">
              Paste the private key of an existing EVM wallet to import it. It&rsquo;s encrypted by
              your wallet provider — never shared with Quant AI.
            </p>
            <div className="flex gap-2">
              <Input
                value={pk}
                onChange={(e) => setPk(e.target.value)}
                placeholder="0x… private key"
                type="password"
                className="flex-1 font-mono text-data-sm"
              />
              <Button size="sm" onClick={doImport} disabled={walletBusy !== null}>
                {walletBusy === "import" ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        ) : null}

        {walletMsg ? (
          <p className="border-b border-line bg-panel px-5 py-2.5 font-mono text-data-sm text-amber">
            {walletMsg}
          </p>
        ) : null}

        {/*
          Detach every external wallet at once.

          Wallets connected before now were attached to the account
          permanently, so they reconnected on every visit with no way to stop
          it. This clears them in one action; the embedded account wallets stay,
          because they are the account.
        */}
        {wallets.some((w) => w.type !== "privy") ? (
          <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-5 py-3">
            <span className="text-xs text-muted">
              Connected wallets reconnect each visit until they&rsquo;re detached.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-loss hover:text-loss"
              onClick={async () => {
                const external = wallets.filter((w) => w.type !== "privy");
                if (!window.confirm(`Disconnect ${external.length} wallet(s)? You keep them — this only unlinks them here.`)) return;
                let done = 0;
                const failures: string[] = [];
                for (const w of external) {
                  try {
                    await unlinkWallet(w.address);
                    done++;
                  } catch (e) {
                    failures.push(`${shortAddress(w.address)}: ${(e as Error).message?.slice(0, 60)}`);
                  }
                }
                setWalletMsg(
                  failures.length
                    ? `Disconnected ${done}. Failed: ${failures.join("; ").slice(0, 160)}`
                    : `Disconnected ${done} wallet(s).`,
                );
              }}
            >
              Disconnect all
            </Button>
          </div>
        ) : null}

        {wallets.length === 0 ? (
          <p className="bg-panel px-5 py-4 text-sm text-muted">Provisioning your wallet…</p>
        ) : (
          wallets.map((w) => (
            <div
              key={w.address}
              className="flex items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3.5 last:border-0"
            >
              <div className="min-w-0">
                <p className="font-mono text-data-sm text-bone" title={w.address}>
                  {shortAddress(w.address)}
                </p>
                <p className="text-xs text-muted">
                  {w.type === "privy" ? "Embedded (Quant AI)" : "Connected / imported"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {activeAddr?.toLowerCase() === w.address.toLowerCase() ? (
                  <Badge variant="amber">Active</Badge>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setActiveWallet(w.address)}>
                    Set active
                  </Button>
                )}
                {/*
                  Only an embedded wallet can be exported — Quant AI holds its
                  key. Offering "reveal key" on a Phantom wallet promises
                  something impossible, and the confirm below told people to
                  export a key that was never ours to give.
                */}
                {w.type === "privy" ? (
                  <Button size="sm" variant="ghost" onClick={() => exportWallet(w.address)}>
                    Reveal key
                  </Button>
                ) : null}
                {/* an external wallet can always be disconnected; the account's
                    own wallet can't be removed if it's the only one left */}
                {w.type !== "privy" || wallets.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-loss hover:text-loss"
                    onClick={async () => {
                      const isExternal = w.type !== "privy";
                      const question = isExternal
                        ? `Disconnect ${shortAddress(w.address)} from your account? You keep the wallet — this only unlinks it here.`
                        : `Remove wallet ${shortAddress(w.address)} from your account? Export its key first if you still need it.`;
                      if (!window.confirm(question)) return;
                      try {
                        await unlinkWallet(w.address);
                        if (active?.toLowerCase() === w.address.toLowerCase()) {
                          localStorage.removeItem("quantai:activeWallet");
                          setActive(null);
                        }
                        setWalletMsg(
                          `${w.type !== "privy" ? "Disconnected" : "Removed"} ${shortAddress(w.address)}.`,
                        );
                      } catch (e) {
                        setWalletMsg((e as Error).message?.slice(0, 120) ?? "Couldn't remove wallet.");
                      }
                    }}
                  >
                    {w.type !== "privy" ? "Disconnect" : "Delete"}
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="overflow-hidden rounded-md border border-line">
        <div className="border-b border-line bg-panel px-5 py-2.5">
          <span className="text-label">Preferences</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">Alert channels</p>
            <p className="text-xs text-muted">In-app, Telegram, Discord</p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/alerts">Manage</Link>
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 bg-panel px-5 py-4">
          <div>
            <p className="text-sm text-bone">Referral code</p>
            <p className="text-xs text-muted">Activates with the rewards ledger</p>
          </div>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/rewards">View rewards</Link>
          </Button>
        </div>
      </section>

      <section className="flex items-center justify-between rounded-md border border-line bg-panel px-5 py-4">
        <div>
          <p className="text-sm text-bone">Session</p>
          <p className="text-xs text-muted">Sign out on this device</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            await logout();
            router.push("/");
          }}
        >
          Sign out
        </Button>
      </section>
    </div>
  );
}
