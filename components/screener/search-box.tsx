"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/*
  Paste-a-CA search: looks the address up in our DB, or ingests + scores it
  on the spot from live sources, then navigates to the analyzed token.
*/
export function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = value.trim();
    /*
      Two address families. EVM is 0x + 40 hex; Solana mints are base58, 32–44
      characters, and CASE-SENSITIVE — so the value is passed through verbatim
      rather than normalised here.
    */
    const isEvm = /^0x[a-fA-F0-9]{40}$/.test(address);
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    if (!isEvm && !isSol) {
      setError("Paste a contract address (0x…) or a Solana mint.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/lookup?address=${encodeURIComponent(address)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      router.push(`/token/${d.chain}/${d.address}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={search} className="flex w-full max-w-md flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a contract address or Solana mint"
          className="font-mono text-data"
          aria-label="Search by contract address"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Analyzing…" : "Analyze"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-loss">
          {error}
        </p>
      ) : null}
    </form>
  );
}
