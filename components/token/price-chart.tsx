"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { analyzeChart } from "@/lib/chart-analysis";
import type { Candle } from "@/lib/mock-series";

/*
  Brand-themed lightweight-charts wrapper. Chart is created once; data updates
  stream in place (series.setData) so the live pull doesn't rebuild/flash.
  The "Analysis" overlay is the signal engine reading the chart like a trader:
  support/resistance levels, a regression trend line, and a moving average.
*/
const INK_TOKENS = {
  text: "#8B877C",
  grid: "#1c1b18",
  border: "#363430",
  gain: "#52B879",
  loss: "#DD4B3E",
  amber: "#EEA02B",
  bone: "#E9E6DD",
};

export type ChartMarker = { time: number; type: "ENTRY" | "EXIT" | "RISK" };
export type TradeMarker = { time: number; side: "BUY" | "SELL" };

function priceStr(p: number) {
  if (p <= 0) return "$0";
  if (p >= 0.01) return "$" + p.toPrecision(4);
  const s = p.toFixed(20);
  const m = s.match(/^0\.(0+)([1-9]\d{0,2})/);
  return m ? `$0.0(${m[1].length})${m[2]}` : "$" + p.toExponential(1);
}

export function PriceChart({
  candles,
  liquidity,
  markers,
  tradeMarkers = [],
  timeframeBar,
  timeframe,
}: {
  candles: Candle[];
  liquidity: { time: number; value: number }[];
  markers: ChartMarker[];
  tradeMarkers?: TradeMarker[];
  timeframeBar?: ReactNode;
  timeframe?: string;
}) {
  const [view, setView] = useState<"price" | "liquidity">("price");
  const [showAnalysis, setShowAnalysis] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceSeries = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volSeries = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liqSeries = useRef<ISeriesApi<any> | null>(null);
  // analysis artifacts, cleared+redrawn each pass
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendSeries = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const smaSeries = useRef<ISeriesApi<any> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);

  const analysis = useMemo(() => (view === "price" ? analyzeChart(candles) : null), [candles, view]);

  // create the chart + series once per view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor: INK_TOKENS.text,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: INK_TOKENS.grid },
        horzLines: { color: INK_TOKENS.grid },
      },
      rightPriceScale: { borderColor: INK_TOKENS.border },
      timeScale: { borderColor: INK_TOKENS.border, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: INK_TOKENS.border, labelBackgroundColor: "#181713" },
        horzLine: { color: INK_TOKENS.border, labelBackgroundColor: "#181713" },
      },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) chart.resize(box.width, box.height);
    });
    ro.observe(el);

    if (view === "price") {
      priceSeries.current = chart.addSeries(CandlestickSeries, {
        upColor: INK_TOKENS.gain,
        downColor: INK_TOKENS.loss,
        borderUpColor: INK_TOKENS.gain,
        borderDownColor: INK_TOKENS.loss,
        wickUpColor: INK_TOKENS.gain,
        wickDownColor: INK_TOKENS.loss,
        priceFormat: { type: "price", precision: 9, minMove: 0.000000001 },
      });
      volSeries.current = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        color: INK_TOKENS.grid,
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    } else {
      liqSeries.current = chart.addSeries(LineSeries, {
        color: INK_TOKENS.amber,
        lineWidth: 2,
        priceFormat: { type: "volume" },
      });
    }

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeries.current = null;
      volSeries.current = null;
      liqSeries.current = null;
      trendSeries.current = null;
      smaSeries.current = null;
      priceLines.current = [];
    };
  }, [view]);

  // push data in place whenever candles/liquidity/analysis toggle change
  useEffect(() => {
    if (view === "price" && priceSeries.current && volSeries.current) {
      priceSeries.current.setData(
        candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
      );
      volSeries.current.setData(
        candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? "rgba(82,184,121,0.35)" : "rgba(221,75,62,0.35)",
        })),
      );
      if (markers.length > 0 || tradeMarkers.length > 0) {
        const times = candles.map((c) => c.time);
        const snap = (ts: number) =>
          times.reduce((best, ct) => (Math.abs(ct - ts) < Math.abs(best - ts) ? ct : best), times[0]);
        const signalMarks = markers.map((m) => ({
          time: snap(m.time) as UTCTimestamp,
          position: m.type === "ENTRY" ? ("belowBar" as const) : ("aboveBar" as const),
          color: m.type === "ENTRY" ? INK_TOKENS.amber : m.type === "EXIT" ? INK_TOKENS.bone : INK_TOKENS.loss,
          shape: m.type === "ENTRY" ? ("arrowUp" as const) : ("arrowDown" as const),
          text: m.type,
        }));
        // the user's own fills: green B on buys, red S on sells
        const tradeMarks = tradeMarkers.map((tr) => ({
          time: snap(tr.time) as UTCTimestamp,
          position: tr.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
          color: tr.side === "BUY" ? INK_TOKENS.gain : INK_TOKENS.loss,
          shape: tr.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
          text: tr.side === "BUY" ? "B" : "S",
        }));
        createSeriesMarkers(
          priceSeries.current,
          [...signalMarks, ...tradeMarks].sort((a, b) => (a.time as number) - (b.time as number)),
        );
      }

      // ── analysis overlay ────────────────────────────────────────
      // clear previous artifacts
      priceLines.current.forEach((l) => priceSeries.current?.removePriceLine(l));
      priceLines.current = [];
      if (trendSeries.current) {
        chartRef.current?.removeSeries(trendSeries.current);
        trendSeries.current = null;
      }
      if (smaSeries.current) {
        chartRef.current?.removeSeries(smaSeries.current);
        smaSeries.current = null;
      }

      if (showAnalysis && analysis && chartRef.current) {
        priceLines.current.push(
          priceSeries.current.createPriceLine({
            price: analysis.resistance,
            color: INK_TOKENS.loss,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "resistance",
          }),
        );
        priceLines.current.push(
          priceSeries.current.createPriceLine({
            price: analysis.support,
            color: INK_TOKENS.gain,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: "support",
          }),
        );
        // moving average
        const s = chartRef.current.addSeries(LineSeries, {
          color: "rgba(233,230,221,0.5)",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(analysis.sma.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
        smaSeries.current = s;
        // regression trend line (2 points across the window)
        const tl = chartRef.current.addSeries(LineSeries, {
          color: INK_TOKENS.amber,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        tl.setData([
          { time: analysis.trend.from.time as UTCTimestamp, value: Math.max(analysis.trend.from.price, 0) },
          { time: analysis.trend.to.time as UTCTimestamp, value: Math.max(analysis.trend.to.price, 0) },
        ]);
        trendSeries.current = tl;
      }
    } else if (view === "liquidity" && liqSeries.current) {
      liqSeries.current.setData(liquidity.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
    chartRef.current?.timeScale().fitContent();
  }, [candles, liquidity, markers, tradeMarkers, view, showAnalysis, analysis]);

  return (
    <div className="flex min-w-0 flex-col rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        {view === "price" && timeframeBar ? timeframeBar : <div className="flex gap-1" />}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(["price", "liquidity"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-data-sm uppercase tracking-[0.1em] transition-colors duration-fast",
                  view === v ? "bg-raised text-amber" : "text-muted hover:text-bone",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {view === "price" ? (
            <button
              onClick={() => setShowAnalysis((s) => !s)}
              aria-pressed={showAnalysis}
              className={cn(
                "rounded border px-2.5 py-1 font-mono text-data-sm transition-colors duration-fast",
                showAnalysis ? "border-amber/50 text-amber" : "border-line text-muted hover:text-bone",
              )}
            >
              Analysis
            </button>
          ) : null}
          <span className="flex items-center gap-1.5 font-mono text-data-sm text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-gain motion-safe:animate-live-pulse" aria-hidden="true" />
            live · {timeframe ?? "15m"}
          </span>
        </div>
      </div>

      {view === "price" && showAnalysis && analysis ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-raised/40 px-4 py-2 font-mono text-data-sm">
          <span className="text-amber">Quant AI read</span>
          <span className="text-muted">
            trend <span className={analysis.trend.dir === "up" ? "text-gain" : analysis.trend.dir === "down" ? "text-loss" : "text-bone"}>{analysis.trend.dir}</span>
          </span>
          <span className="text-muted">
            support <span className="text-gain">{priceStr(analysis.support)}</span>
          </span>
          <span className="text-muted">
            resistance <span className="text-loss">{priceStr(analysis.resistance)}</span>
          </span>
          <span className="hidden text-faint sm:inline">· {analysis.verdict}</span>
        </div>
      ) : null}

      <div ref={containerRef} className="h-[460px] w-full min-w-0" />
    </div>
  );
}
