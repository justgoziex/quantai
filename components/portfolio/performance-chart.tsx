"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/*
  Equity curve — cumulative PnL over time from the trade history, ending at the
  current mark-to-market total. Pure SVG (no chart lib): an area under the line,
  a baseline at $0, and a hover readout. Gain/loss colored by the final value.
*/
type Point = { t: number; pnl: number };

function fmtUsd(n: number) {
  const s = Math.abs(n) >= 1000 ? Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : Math.abs(n).toFixed(2);
  return `${n < 0 ? "−" : ""}$${s}`;
}

export function PerformanceChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 260;
  const padY = 24;

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const ts = points.map((p) => p.t);
    const vs = points.map((p) => p.pnl);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMax = Math.max(...vs, 0);
    const vMin = Math.min(...vs, 0);
    const range = vMax - vMin || 1;
    const x = (t: number) => ((t - tMin) / (tMax - tMin || 1)) * W;
    const y = (v: number) => H - padY - ((v - vMin) / range) * (H - padY * 2);
    const coords = points.map((p) => ({ x: x(p.t), y: y(p.pnl), ...p }));
    const zeroY = y(0);
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const area = `${line} L${W},${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`;
    return { coords, line, area, zeroY };
  }, [points]);

  if (!geom) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-md border border-line bg-panel">
        <p className="text-sm text-muted">Your performance curve appears here after your first trade.</p>
      </div>
    );
  }

  const final = points[points.length - 1].pnl;
  const up = final >= 0;
  const stroke = up ? "var(--gain, #4ade80)" : "var(--loss, #f87171)";
  const active = hover !== null ? geom.coords[hover] : null;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-label">Performance</span>
        <span className={cn("font-mono text-data tabular", up ? "text-gain" : "text-loss")}>
          {active ? fmtUsd(active.pnl) : fmtUsd(final)}
          {active ? (
            <span className="ml-2 text-faint">{new Date(active.t).toLocaleDateString()}</span>
          ) : (
            <span className="ml-2 text-faint">all-time</span>
          )}
        </span>
      </div>
      <div className="relative px-1 py-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            let best = 0;
            let bestD = Infinity;
            geom.coords.forEach((c, i) => {
              const d = Math.abs(c.x - px);
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            });
            setHover(best);
          }}
        >
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* zero baseline */}
          <line x1="0" y1={geom.zeroY} x2={W} y2={geom.zeroY} stroke="currentColor" className="text-line" strokeWidth="1" strokeDasharray="4 4" />
          <path d={geom.area} fill="url(#pnlFill)" />
          <path d={geom.line} fill="none" stroke={stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {active ? (
            <>
              <line x1={active.x} y1="0" x2={active.x} y2={H} stroke="currentColor" className="text-line-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <circle cx={active.x} cy={active.y} r="4" fill={stroke} />
            </>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
