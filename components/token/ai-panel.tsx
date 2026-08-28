"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
  Quant AI desk analysis — runs on demand. The user clicks Analyze; the read
  then streams in live, opening with an entry verdict. It stays put until they
  re-run it.
*/
type Verdict = { label: string; confidence: number } | null;

const VERDICT_STYLE: Record<string, { variant: BadgeProps["variant"]; bar: string }> = {
  "GOOD ENTRY": { variant: "gain", bar: "bg-gain" },
  "FAIR ENTRY": { variant: "warn", bar: "bg-warn" },
  "BAD ENTRY": { variant: "loss", bar: "bg-loss" },
  AVOID: { variant: "loss", bar: "bg-loss" },
};

function parseVerdict(text: string): { verdict: Verdict; body: string } {
  const m = text.match(/^\s*VERDICT:\s*(GOOD ENTRY|FAIR ENTRY|BAD ENTRY|AVOID)\s*\|\s*CONFIDENCE:\s*(\d{1,3})/i);
  if (!m) return { verdict: null, body: text };
  return {
    verdict: { label: m[1].toUpperCase(), confidence: Math.min(100, Number(m[2])) },
    body: text.slice(m.index! + m[0].length).replace(/^[^\n]*\n?/, ""),
  };
}

export function AiPanel({ chain, address }: { chain: string; address: string }) {
  const [text, setText] = useState("");
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStarted(true);
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/analyze/${chain}/${address}`, { signal: ctrl.signal });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        throw new Error(d?.error ?? `HTTP ${r.status}`);
      }
      const type = r.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        // fresh cache
        const d = await r.json();
        setText(d.analysis);
        setAsOf(d.at ? new Date(d.at) : new Date());
        setLoading(false);
        return;
      }
      // live stream
      setText("");
      setLoading(false);
      setStreaming(true);
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setText(acc);
      }
      setAsOf(new Date());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  }, [chain, address]);

  // no auto-run — abort any in-flight stream on unmount only
  useEffect(() => () => abortRef.current?.abort(), []);

  const { verdict, body } = parseVerdict(text);
  const style = verdict ? VERDICT_STYLE[verdict.label] : null;

  return (
    <section className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2">
          <Mark size={16} className="text-amber" tailClassName="text-amber" />
          <span className="text-label">Quant AI desk analysis</span>
          {streaming ? (
            <span className="flex items-center gap-1.5 font-mono text-data-sm text-amber">
              <span className="h-1.5 w-1.5 rounded-full bg-amber motion-safe:animate-live-pulse" />
              reading the chain
            </span>
          ) : asOf ? (
            <span className="font-mono text-data-sm text-faint">as of {asOf.toLocaleTimeString()}</span>
          ) : null}
        </span>
        {started ? (
          <Button variant="ghost" size="sm" onClick={load} disabled={loading || streaming}>
            Re-analyze
          </Button>
        ) : null}
      </div>

      {/* verdict strip */}
      {verdict && style ? (
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3">
          <Badge variant={style.variant} className="px-2.5 py-1 text-data">
            {verdict.label}
          </Badge>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-data-sm text-muted">confidence</span>
            <span className="flex gap-0.5" aria-hidden="true">
              {Array.from({ length: 20 }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-3 w-1",
                    i < Math.round((verdict.confidence / 100) * 20) ? style.bar : "bg-line",
                  )}
                />
              ))}
            </span>
            <span className="font-mono text-data tabular text-bone">{verdict.confidence}</span>
          </div>
        </div>
      ) : null}

      {!started ? (
        <div className="flex flex-col items-center gap-4 px-5 py-10 text-center">
          <p className="max-w-sm text-sm text-muted">
            Get Quant AI&rsquo;s read on this token — a gambler&rsquo;s take on the setup, the
            risks, and the odds, from live on-chain data and web research.
          </p>
          <Button onClick={load}>Analyze this token</Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-3 px-5 py-5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-3 px-5 py-6">
          <p className="text-sm text-muted">{error}</p>
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-5 py-4">
          {body.split("\n").map((line, i) => {
            const t = line.trim();
            if (!t) return null;
            if (t.startsWith("##")) {
              return (
                <p key={i} className="text-label mt-3 first:mt-0">
                  {t.replace(/^#+\s*/, "")}
                </p>
              );
            }
            return (
              <p key={i} className="text-sm leading-relaxed text-muted">
                {t.replace(/\*\*/g, "")}
              </p>
            );
          })}
          {streaming ? <span className="mt-1 inline-block h-4 w-2 animate-skeleton-pulse bg-amber" /> : null}
          {!streaming && body ? (
            <p className="mt-3 border-t border-line pt-2.5 font-mono text-data-sm text-faint">
              Quant AI engine · live gate + market + candle data · analytics, not advice
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
