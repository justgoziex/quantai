"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { detectWallets, connectAndProve, type DetectedWallet, type SignedProof } from "@/lib/wallet-connect";
import { cn } from "@/lib/utils";

/*
  The wallet picker every dApp has: what's installed, pick one, sign.

  It shows wallets, not addresses. An earlier version listed the addresses the
  browser had connected before, which is an implementation detail no product
  puts on screen — a person picks "Phantom", not a hex string they don't
  recognise.

  Nothing here touches the account. Connecting a deployer wallet proves control
  of it for this one action and nothing more.
*/
export function WalletPicker({
  open,
  onClose,
  onProof,
}: {
  open: boolean;
  onClose: () => void;
  onProof: (proof: SignedProof) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [wallets, setWallets] = useState<DetectedWallet[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setWallets(null);
    void detectWallets().then(setWallets);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const pick = useCallback(
    async (w: DetectedWallet) => {
      setError(null);
      setBusy(w.id);
      try {
        const proof = await connectAndProve(w, "dev");
        await onProof(proof);
        onClose();
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        setError(
          /reject|denied|cancel|User rejected/i.test(m)
            ? t("Cancelled in your wallet.")
            : m || t("Couldn't connect to that wallet."),
        );
      } finally {
        setBusy(null);
      }
    },
    [onProof, onClose, t],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] rounded-lg border border-line-strong bg-panel p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-h3 text-bone">{t("Connect a wallet")}</p>
          <button
            onClick={onClose}
            aria-label={t("Close")}
            className="flex h-7 w-7 items-center justify-center rounded border border-line text-faint transition-colors duration-fast hover:border-line-strong hover:text-bone"
          >
            <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        {wallets === null ? (
          <p className="py-6 text-center text-sm text-muted">{t("Looking for wallets…")}</p>
        ) : wallets.length === 0 ? (
          /*
            Nothing installed. Said plainly, with the reason — a browser with
            no wallet extension can't connect one, and pretending otherwise
            sends people in circles.
          */
          <p className="py-5 text-sm text-muted">
            {t("No wallet found in this browser. Install Phantom or MetaMask, or open this page inside your wallet's browser on mobile.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {wallets.map((w) => (
              <button
                key={w.id}
                onClick={() => pick(w)}
                disabled={busy !== null}
                className={cn(
                  "flex items-center gap-3 rounded border border-line px-3 py-2.5 text-left transition-colors duration-fast",
                  busy === w.id
                    ? "border-amber bg-raised"
                    : "hover:border-line-strong hover:bg-raised disabled:opacity-50",
                )}
              >
                {w.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.icon} alt="" className="h-6 w-6 rounded" />
                ) : (
                  <span className="h-6 w-6 rounded bg-raised" />
                )}
                <span className="text-sm text-bone">{w.name}</span>
                <span className="ml-auto font-mono text-data-sm text-faint">
                  {busy === w.id ? t("check your wallet…") : w.vm === "svm" ? "Solana" : "EVM"}
                </span>
              </button>
            ))}
          </div>
        )}

        {error ? <p className="mt-3 text-xs text-loss">{error}</p> : null}

        <p className="mt-4 text-xs text-faint">
          {t("You'll be asked to sign a message. It proves you own the wallet and costs nothing.")}
        </p>
      </div>
    </div>
  );
}
