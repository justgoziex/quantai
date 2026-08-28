"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallets } from "@privy-io/react-auth";
import { encodeDeployData, parseUnits, parseEther, type Address, type Hex } from "viem";
import { cn } from "@/lib/utils";
import { CHAINS, LAUNCHABLE_CHAINS, type ChainId, type EvmChainId } from "@/lib/chains";
import { SolanaLaunch } from "./solana-launch";
import { DEX_CONFIG, waitForTx, buildFeeTx } from "@/lib/dex";
import { ERC20_TEMPLATE_ABI, ERC20_TEMPLATE_BYTECODE } from "@/lib/erc20-template";
import {
  DEFAULT_CONFIG,
  validateBasics,
  formatSupply,
  scoreLaunchConfig,
  type LaunchConfig,
} from "@/lib/launch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SignalScore } from "@/components/product/signal-score";
import { useAuth, shortAddress } from "@/components/auth/auth-context";
import { ScorePreview } from "./score-preview";

const STEPS = ["Chain", "Token", "Economics", "Review"] as const;

const DEPLOY_STAGES = [
  "Compiling contract from audited template",
  "Deploying to network",
  "Verifying source on explorer",
  "Seeding liquidity pool",
  "Locking LP tokens",
] as const;

function fakeAddress(seed: string): string {
  let h = 0x9e3779b9;
  for (const ch of seed + "quantai") h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out += ((h >>> 16) % 16).toString(16);
  }
  return out;
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-loss">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min);
        }}
        className="w-24 font-mono text-data"
      />
      <span className="font-mono text-data-sm text-muted">{suffix}</span>
    </div>
  );
}

export function LaunchWizard({
  launchFeeEth = 0,
  launchFeeBnb = 0,
  feeWallet = "",
}: {
  launchFeeEth?: number;
  launchFeeBnb?: number;
  feeWallet?: string;
} = {}) {
  const [step, setStep] = useState(0);
  /* Solana isn't a variant of the EVM flow — picking it swaps the whole panel */
  const [svmChain, setSvmChain] = useState(false);
  const [config, setConfig] = useState<LaunchConfig>(DEFAULT_CONFIG);
  const feeValid = /^0x[0-9a-fA-F]{40}$/.test(feeWallet);
  const launchFee = (c: EvmChainId) => (feeValid ? (c === "eth" ? launchFeeEth : c === "bsc" ? launchFeeBnb : 0) : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deployStage, setDeployStage] = useState<number | null>(null);
  const [deployed, setDeployed] = useState(false);
  const { authenticated, walletAddress, getToken } = useAuth();
  const [saved, setSaved] = useState(false);
  const { wallets } = useWallets();
  const [deploy, setDeploy] = useState<
    | null
    | { phase: "switching" | "signing" | "confirming"; hash?: Hex }
    | { phase: "done"; hash: Hex; contract: string }
    | { phase: "error"; message: string }
  >(null);

  const chain = CHAINS[config.chain];
  const set = <K extends keyof LaunchConfig>(k: K, v: LaunchConfig[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  const next = () => {
    if (step === 1) {
      const errs = validateBasics(config);
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const simulateDeploy = () => {
    setDeployStage(0);
    DEPLOY_STAGES.forEach((_, i) => {
      setTimeout(() => {
        setDeployStage(i + 1);
        if (i === DEPLOY_STAGES.length - 1) setDeployed(true);
      }, 650 * (i + 1));
    });
    // persist the reviewed config to the user's launches
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const r = await fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...config, contractAddress: fakeAddress(config.symbol + config.chain) }),
        });
        setSaved(r.ok);
      } catch {
        /* preview continues regardless */
      }
    })();
  };

  const { score } = scoreLaunchConfig(config);
  const address = fakeAddress(config.symbol + config.chain);

  /* Real on-chain deployment — signs the contract creation from the wallet. */
  const deployOnChain = async () => {
    const wallet = wallets.find((w) => w.walletClientType === "privy");
    if (!wallet) {
      setDeploy({ phase: "error", message: "No wallet available — sign out and back in." });
      return;
    }
    try {
      const cfg = DEX_CONFIG[config.chain];
      setDeploy({ phase: "switching" });
      await wallet.switchChain(cfg.chainIdNum);
      const provider = await wallet.getEthereumProvider();

      // platform launch fee — charged before deployment
      const fee = launchFee(config.chain);
      if (fee > 0) {
        setDeploy({ phase: "signing" });
        const feeHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: wallet.address, ...buildFeeTx(feeWallet as Address, parseEther(String(fee))) }],
        })) as Hex;
        await waitForTx(config.chain, feeHash);
      }

      const data = encodeDeployData({
        abi: ERC20_TEMPLATE_ABI,
        bytecode: ERC20_TEMPLATE_BYTECODE,
        args: [config.name.trim(), config.symbol, parseUnits(config.totalSupply, 18)],
      });

      setDeploy({ phase: "signing" });
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: wallet.address, data }],
      })) as Hex;
      setDeploy({ phase: "confirming", hash });

      const receipt = await waitForTx(config.chain, hash);
      const contract = receipt.contractAddress;
      if (!contract) throw new Error("No contract address in receipt.");

      // persist as DEPLOYED
      try {
        const token = await getToken();
        const r = await fetch("/api/launch", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ ...config, contractAddress: contract, txHash: hash, deployed: true }),
        });
        setSaved(r.ok);
      } catch {
        /* deployment succeeded on-chain regardless */
      }
      setDeploy({ phase: "done", hash, contract });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setDeploy({
        phase: "error",
        message: /rejected|denied/i.test(msg)
          ? "Deployment rejected in wallet."
          : /insufficient/i.test(msg)
            ? `Not enough ${CHAINS[config.chain].gas} for deployment gas.`
            : msg.slice(0, 140),
      });
    }
  };

  /* ---------- real on-chain deploy success ---------- */
  if (deploy?.phase === "done") {
    const cfg = DEX_CONFIG[config.chain];
    return (
      <div className="rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-label">Deployed on-chain{saved ? " · saved to your launches" : ""}</span>
          <Badge variant="gain">Live</Badge>
        </div>
        <div className="flex flex-col gap-5 px-5 py-6">
          <div>
            <h3 className="text-h1 mb-1 text-bone">
              {config.name} <span className="text-muted">({config.symbol})</span>
            </h3>
            <p className="break-all font-mono text-data-sm text-muted">
              {deploy.contract} ·{" "}
              <a
                href={`https://${cfg.explorerTx.includes("bsc") ? "bscscan.com" : "etherscan.io"}/token/${deploy.contract}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-bone"
              >
                view token
              </a>{" "}
              ·{" "}
              <a
                href={cfg.explorerTx + deploy.hash}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-bone"
              >
                deploy tx
              </a>
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
            {[
              ["Network", chain.name],
              ["Supply", formatSupply(config.totalSupply) + " " + config.symbol],
              ["Holds now", "100% in your wallet"],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel px-4 py-3">
                <p className="text-label mb-1">{k}</p>
                <p className="font-mono text-data text-bone">{v}</p>
              </div>
            ))}
          </div>
          <div className="rounded border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-bone">
            Your token is live and the full supply is in your wallet. To make it
            tradeable, add liquidity on {chain.dex.replace(/ v\d.*/, "")}: pair
            your {config.symbol} with {chain.gas} to open the market. The moment
            that pool exists, Quant AI will pick it up and score it.
          </div>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setDeploy(null);
                setSaved(false);
                setStep(0);
                setConfig(DEFAULT_CONFIG);
              }}
            >
              Launch another token
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- simulated preview success ---------- */
  if (deployed) {
    return (
      <div className="rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-label">
            Deployment preview complete{saved ? " · saved to your launches" : ""}
          </span>
          <Badge variant="warn">Simulated</Badge>
        </div>
        <div className="flex flex-col gap-5 px-5 py-6">
          <div>
            <h3 className="text-h1 mb-1 text-bone">
              {config.name} <span className="text-muted">({config.symbol})</span>
            </h3>
            <p className="font-mono text-data-sm text-muted">
              {address} · {chain.explorer}
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
            {[
              ["Network", chain.name],
              ["Supply", formatSupply(config.totalSupply) + " " + config.symbol],
              ["LP lock", config.lpLockDays > 0 ? config.lpLockDays + " days" : "None"],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel px-4 py-3">
                <p className="text-label mb-1">{k}</p>
                <p className="font-mono text-data text-bone">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded border border-line px-4 py-3">
            <div>
              <p className="text-sm text-bone">Listing reading at launch</p>
              <p className="text-xs text-muted">What the screener will show the moment your pair goes live</p>
            </div>
            <SignalScore score={score} size="sm" />
          </div>
          <p className="rounded border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-bone">
            This was a preview — nothing touched the chain. To deploy for real,
            go back and use <span className="text-bone">Deploy on {CHAINS[config.chain].shortName}</span>,
            which signs the contract creation from your wallet.
          </p>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setDeployed(false);
                setDeployStage(null);
                setSaved(false);
                setStep(0);
                setConfig(DEFAULT_CONFIG);
              }}
            >
              Configure another token
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- deploying progress ---------- */
  if (deployStage !== null) {
    return (
      <div className="rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-label">Deploying {config.symbol} · {chain.shortName}</span>
          <Badge variant="warn">Simulated</Badge>
        </div>
        <ul className="flex flex-col px-5 py-4">
          {DEPLOY_STAGES.map((s, i) => (
            <li key={s} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  i < deployStage
                    ? "bg-gain"
                    : i === deployStage
                      ? "bg-amber motion-safe:animate-live-pulse"
                      : "bg-line-strong",
                )}
                aria-hidden="true"
              />
              <span className={cn("text-sm", i <= deployStage ? "text-bone" : "text-faint")}>
                {s}
              </span>
              {i < deployStage && (
                <span className="ml-auto font-mono text-data-sm text-gain">done</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /* ---------- wizard ---------- */
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[7fr_5fr]">
      <div className="min-w-0 rounded-md border border-line bg-panel">
        {/* stepper */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-5 py-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded px-2 py-1 font-mono text-data-sm uppercase tracking-[0.1em] transition-colors duration-fast",
                i === step ? "text-amber" : i < step ? "text-bone hover:text-amber" : "text-faint",
              )}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {s}
              {i < STEPS.length - 1 && <span className="pl-1 text-line-strong">/</span>}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            className="px-5 py-6"
          >
            {svmChain && step === 0 ? (
              /*
                Solana takes over from here. There's no contract to configure —
                no taxes, no max wallet, no LP lock — so the remaining wizard
                steps would all be questions the chain can't answer.
              */
              <div className="mt-6">
                <SolanaLaunch />
              </div>
            ) : null}
            {step === 0 && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  Pick the network. Fees, DEX, and explorer verification differ —
                  the risk gates don&rsquo;t.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {LAUNCHABLE_CHAINS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() =>
                        c.id === "sol" ? setSvmChain(true) : (setSvmChain(false), set("chain", c.id as EvmChainId))
                      }
                      className={cn(
                        "rounded border px-4 py-4 text-left transition-colors duration-fast",
                        (c.id === "sol" ? svmChain : !svmChain && config.chain === c.id)
                          ? "border-amber bg-raised"
                          : "border-line hover:border-line-strong hover:bg-raised",
                      )}
                      aria-pressed={c.id === "sol" ? svmChain : !svmChain && config.chain === c.id}
                    >
                      <p className="mb-1 flex items-center justify-between text-h3 text-bone">
                        {c.name}
                        {(c.id === "sol" ? svmChain : !svmChain && config.chain === c.id) && (
                          <span className="text-amber">●</span>
                        )}
                      </p>
                      <p className="font-mono text-data-sm text-muted">
                        {c.dex} · gas in {c.gas}
                      </p>
                      <p className="mt-2 font-mono text-data-sm text-faint">
                        {launchFee(c.id as EvmChainId) > 0
                          ? `launch fee ${launchFee(c.id as EvmChainId)} ${c.gas} + gas`
                          : `gas only`}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="grid max-w-xl gap-5">
                <Field label="Token name" error={errors.name}>
                  <Input
                    value={config.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Nocturne"
                    maxLength={40}
                  />
                </Field>
                <Field label="Symbol" error={errors.symbol} hint="2–8 characters, uppercase.">
                  <Input
                    value={config.symbol}
                    onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    placeholder="NOCTA"
                    maxLength={8}
                    className="w-40 font-mono text-data uppercase"
                  />
                </Field>
                <Field
                  label="Total supply"
                  error={errors.totalSupply}
                  hint={`Reads as ${formatSupply(config.totalSupply)} ${config.symbol || "tokens"} · 18 decimals, fixed`}
                >
                  <Input
                    value={config.totalSupply}
                    onChange={(e) => set("totalSupply", e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    className="w-64 font-mono text-data"
                  />
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-7">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Buy tax" hint="0–5% reads clean. Above 10% costs score fast.">
                    <NumberField value={config.buyTaxPct} onChange={(v) => set("buyTaxPct", v)} min={0} max={30} suffix="%" />
                  </Field>
                  <Field label="Sell tax">
                    <NumberField value={config.sellTaxPct} onChange={(v) => set("sellTaxPct", v)} min={0} max={30} suffix="%" />
                  </Field>
                  <Field label="Max wallet" hint="0 disables the limit.">
                    <NumberField value={config.maxWalletPct} onChange={(v) => set("maxWalletPct", v)} min={0} max={100} suffix="% of supply" />
                  </Field>
                  <Field label={`Initial liquidity (${chain.gas})`} hint="Seeded to the pool at deploy.">
                    <Input
                      value={config.initialLiquidity}
                      onChange={(e) => set("initialLiquidity", e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder={config.chain === "eth" ? "2.0" : "10"}
                      inputMode="decimal"
                      className="w-32 font-mono text-data"
                    />
                  </Field>
                </div>

                <Field label="LP lock duration" hint="180+ days passes the lock gate outright.">
                  <div className="flex flex-wrap gap-2">
                    {([0, 30, 90, 180, 365] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => set("lpLockDays", d)}
                        aria-pressed={config.lpLockDays === d}
                        className={cn(
                          "rounded border px-3 py-1.5 font-mono text-data-sm transition-colors duration-fast",
                          config.lpLockDays === d
                            ? "border-amber text-amber"
                            : "border-line text-muted hover:border-line-strong hover:text-bone",
                        )}
                      >
                        {d === 0 ? "No lock" : `${d}d`}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="flex flex-col gap-4">
                  <label className="flex items-center justify-between gap-4 rounded border border-line px-4 py-3">
                    <span>
                      <span className="block text-sm text-bone">Renounce ownership</span>
                      <span className="block text-xs text-muted">No privileged functions after deploy. Irreversible.</span>
                    </span>
                    <Switch checked={config.renounceOwnership} onCheckedChange={(v) => set("renounceOwnership", v)} />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded border border-line px-4 py-3">
                    <span>
                      <span className="block text-sm text-bone">Revoke mint authority</span>
                      <span className="block text-xs text-muted">Supply can never inflate. Traders check this first.</span>
                    </span>
                    <Switch checked={config.revokeMint} onCheckedChange={(v) => set("revokeMint", v)} />
                  </label>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2">
                  {[
                    ["Network", `${chain.name} · ${chain.dex}`],
                    ["Token", `${config.name || "—"} (${config.symbol || "—"})`],
                    ["Supply", `${formatSupply(config.totalSupply)} · 18 decimals`],
                    ["Taxes", `${config.buyTaxPct}% buy / ${config.sellTaxPct}% sell`],
                    ["Max wallet", config.maxWalletPct > 0 ? `${config.maxWalletPct}% of supply` : "No limit"],
                    ["Liquidity", `${config.initialLiquidity || "0"} ${chain.gas} · lock ${config.lpLockDays > 0 ? config.lpLockDays + "d" : "none"}`],
                    ["Ownership", config.renounceOwnership ? "Renounced at deploy" : "Retained"],
                    ["Mint", config.revokeMint ? "Revoked at deploy" : "Open"],
                    [
                      "Deployer",
                      authenticated && walletAddress
                        ? `${shortAddress(walletAddress)} (your wallet)`
                        : "Sign in to attach your wallet",
                    ],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-panel px-4 py-3">
                      <p className="text-label mb-1">{k}</p>
                      <p className="font-mono text-data text-bone">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded border border-line px-4 py-3">
                  <span className="text-sm text-muted">Cost</span>
                  <span className="font-mono text-data text-bone">network gas only</span>
                </div>
                <p className="text-xs text-faint">
                  Deploys a real, verified-source, fixed-supply ERC-20 from your
                  wallet — no owner, no mint, no taxes. Entire supply mints to
                  you. You then add liquidity on{" "}
                  {chain.dex.replace(/ v\d.*/, "")} to make it tradeable. Gas is
                  paid from your wallet; nothing else is charged.
                </p>
                {deploy?.phase === "error" ? (
                  <p className="text-xs text-loss">{deploy.message}</p>
                ) : deploy?.phase === "confirming" ? (
                  <p className="text-xs text-muted">
                    Deploying on-chain ·{" "}
                    <a
                      href={DEX_CONFIG[config.chain].explorerTx + deploy.hash}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4"
                    >
                      view tx
                    </a>
                  </p>
                ) : null}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>Continue</Button>
          ) : (
            <div className="flex gap-3">
              <Button variant="secondary" onClick={simulateDeploy}>
                Preview only
              </Button>
              <Button
                onClick={deployOnChain}
                disabled={Boolean(deploy && deploy.phase !== "error")}
              >
                {deploy?.phase === "switching"
                  ? "Switching chain…"
                  : deploy?.phase === "signing"
                    ? "Submitting…"
                    : deploy?.phase === "confirming"
                      ? "Deploying…"
                      : `Deploy on ${CHAINS[config.chain].shortName}`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <ScorePreview config={config} />
    </div>
  );
}
