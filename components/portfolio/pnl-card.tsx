"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  Shareable PnL card — canvas-rendered so it exports as a real PNG.
  Ships with a designed default background (light-trail photo + ghosted Q
  mark); users can drop in their own image. Layout and type are drawn to
  match the terminal aesthetic.
*/
export type PnlPosition = {
  symbol: string;
  chain: string;
  /*
    What was put in, in dollars. The card deliberately carries no entry price
    or live price — a shared card is about the outcome, not the fill.
  */
  investedUsd: number;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
  realizedPnlUsd: number;
  score: number;
};

const W = 1200;
const H = 630;

export function PnlCard({ position, onClose }: { position: PnlPosition; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bgUrl, setBgUrl] = useState<string>("/img/pnl-default-bg.jpg");
  const [rendering, setRendering] = useState(true);
  const [copied, setCopied] = useState(false);

  const pnl = (position.unrealizedPnlUsd ?? 0) + position.realizedPnlUsd;
  const invested = position.investedUsd;
  const roiPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const up = pnl >= 0;

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setRendering(true);

    // ensure the canvas fonts are loaded before drawing text
    try {
      await Promise.all([
        document.fonts.load("600 128px 'Geist Canvas'"),
        document.fonts.load("600 26px 'Geist Canvas'"),
        document.fonts.load("500 26px 'Geist Mono Canvas'"),
      ]);
    } catch {
      /* fall back to system fonts */
    }

    // background image
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // cover-fit
        const r = Math.max(W / img.width, H / img.height);
        const w = img.width * r;
        const h = img.height * r;
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        resolve();
      };
      img.onerror = () => {
        ctx.fillStyle = "#0A0A09";
        ctx.fillRect(0, 0, W, H);
        resolve();
      };
      img.src = bgUrl;
    });

    // legibility scrim (flat, left-weighted)
    ctx.fillStyle = "rgba(10,10,9,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,10,9,0.78)";
    ctx.fillRect(0, 0, 620, H);

    const AMBER = "#EEA02B";
    const BONE = "#E9E6DD";
    const MUTED = "#8B877C";
    const GAIN = "#52B879";
    const LOSS = "#DD4B3E";
    const pad = 64;

    // brand mark (Signal Q) top-left
    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(0.5, 0.5);
    ctx.lineWidth = 7;
    ctx.strokeStyle = BONE;
    ctx.beginPath();
    ctx.arc(29, 29, 20, (65 * Math.PI) / 180, (25 * Math.PI) / 180, false);
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.beginPath();
    ctx.moveTo(25.5, 25.5);
    ctx.lineTo(55.5, 55.5);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = BONE;
    ctx.font = "600 26px 'Geist Canvas', system-ui, sans-serif";
    ctx.fillText("QUANT", pad + 46, pad + 26);
    ctx.fillStyle = AMBER;
    ctx.fillText("AI", pad + 46 + ctx.measureText("QUANT ").width, pad + 26);

    // token + chain
    ctx.fillStyle = MUTED;
    ctx.font = "500 22px 'Geist Mono Canvas', monospace";
    ctx.fillText(`${position.symbol} · ${position.chain}`, pad, 210);

    // ROI headline
    ctx.fillStyle = up ? GAIN : LOSS;
    ctx.font = "600 128px 'Geist Canvas', system-ui, sans-serif";
    const roiText = `${up ? "+" : ""}${roiPct.toFixed(1)}%`;
    ctx.fillText(roiText, pad - 4, 330);

    // pnl usd
    ctx.fillStyle = BONE;
    ctx.font = "600 44px 'Geist Mono Canvas', monospace";
    ctx.fillText(`${up ? "+" : "-"}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, pad, 400);

    // stat row — columns sized to their content, no collisions
    const stats: [string, string][] = [
      ["INVESTED", "$" + Math.round(invested).toLocaleString()],
      ["VALUE", position.valueUsd !== null ? "$" + Math.round(position.valueUsd).toLocaleString() : "—"],
      ["SIGNAL", String(position.score)],
    ];
    let sx = pad;
    ctx.textBaseline = "alphabetic";
    stats.forEach(([label, value]) => {
      ctx.fillStyle = MUTED;
      ctx.font = "500 15px 'Geist Mono Canvas', monospace";
      ctx.fillText(label, sx, 480);
      ctx.fillStyle = BONE;
      ctx.font = "500 26px 'Geist Mono Canvas', monospace";
      ctx.fillText(value, sx, 512);
      const w = Math.max(ctx.measureText(value).width, 60);
      sx += w + 46;
    });

    // footer
    ctx.fillStyle = MUTED;
    ctx.font = "500 18px 'Geist Mono Canvas', monospace";
    ctx.fillText("quantai · signal-grade screening", pad, H - 48);

    setRendering(false);
  }, [bgUrl, position, pnl, roiPct, up]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setBgUrl(URL.createObjectURL(file));
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `quantai-${position.symbol}-pnl.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  /* Straight to the clipboard, so it can be pasted into a chat without a file. */
  const copy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("no blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard image writes aren't available everywhere — Download still is */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col gap-4 rounded-md border border-line bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-label">Share PnL · {position.symbol}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-faint transition-colors duration-fast hover:text-bone"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>

        <div className={cn("relative overflow-hidden rounded border border-line", rendering && "animate-skeleton-pulse")}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="block h-auto w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={download}>Download PNG</Button>
          <Button variant="secondary" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <label className="cursor-pointer">
            <span className="inline-flex h-8 items-center rounded border border-line-strong px-3.5 text-sm text-bone transition-colors duration-fast hover:bg-raised hover:border-faint">
              Use my background
            </span>
            <input type="file" accept="image/*" onChange={onUpload} className="sr-only" />
          </label>
          {bgUrl !== "/img/pnl-default-bg.jpg" ? (
            <button
              onClick={() => setBgUrl("/img/pnl-default-bg.jpg")}
              className="rounded text-xs text-muted underline-offset-4 hover:text-bone hover:underline"
            >
              Reset to default
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
