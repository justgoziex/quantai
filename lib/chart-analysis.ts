import type { Candle } from "@/lib/mock-series";

/*
  Chart analysis — the lines the signal engine "draws" on the chart, the way a
  trader reads structure: support/resistance from swing extremes, a
  regression trend line, and a moving average. All derived from the candles
  currently in view, so it re-reads whenever the timeframe changes.
*/
export type ChartAnalysis = {
  support: number;
  resistance: number;
  trend: { from: { time: number; price: number }; to: { time: number; price: number }; dir: "up" | "down" | "flat" };
  sma: { time: number; value: number }[];
  verdict: string;
};

/* Linear regression over (index, close) → slope + intercept. */
function regression(closes: number[]): { slope: number; intercept: number } {
  const n = closes.length;
  if (n < 2) return { slope: 0, intercept: closes[0] ?? 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += closes[i];
    sxy += i * closes[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/* Simple moving average, window w, aligned to each candle time. */
function sma(candles: Candle[], w: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  for (let i = w - 1; i < candles.length; i++) {
    let s = 0;
    for (let j = i - w + 1; j <= i; j++) s += candles[j].close;
    out.push({ time: candles[i].time, value: s / w });
  }
  return out;
}

export function analyzeChart(candles: Candle[]): ChartAnalysis | null {
  if (!candles || candles.length < 8) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // support/resistance — extremes of the recent window (last ~60% weighted to
  // "recent" structure, but we keep it simple: window min/max)
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);

  // regression trend across the window
  const { slope, intercept } = regression(closes);
  const first = candles[0];
  const last = candles[candles.length - 1];
  const startPrice = intercept;
  const endPrice = intercept + slope * (closes.length - 1);
  const change = startPrice !== 0 ? (endPrice - startPrice) / Math.abs(startPrice) : 0;
  const dir = change > 0.03 ? "up" : change < -0.03 ? "down" : "flat";

  const window = Math.min(20, Math.max(5, Math.floor(candles.length / 4)));
  const movingAvg = sma(candles, window);

  const cur = last.close;
  const nearSup = (cur - support) / (cur || 1);
  const nearRes = (resistance - cur) / (cur || 1);
  let verdict: string;
  if (dir === "up" && nearRes < 0.08) verdict = "Uptrend pressing resistance — a clean break opens room; rejection here is the risk.";
  else if (dir === "up") verdict = "Higher-low structure holding; trend is up while price stays above the mean.";
  else if (dir === "down" && nearSup < 0.08) verdict = "Downtrend into support — watch for a bounce or a breakdown; don't catch it mid-fall.";
  else if (dir === "down") verdict = "Lower-high structure; trend is down until price reclaims the mean line.";
  else verdict = "Ranging between support and resistance — trade the edges, not the middle.";

  return {
    support,
    resistance,
    trend: {
      from: { time: first.time, price: startPrice },
      to: { time: last.time, price: endPrice },
      dir,
    },
    sma: movingAvg,
    verdict,
  };
}
