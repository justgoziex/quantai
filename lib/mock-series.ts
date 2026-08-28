/*
  Deterministic mock market series, seeded from the token address so charts
  are stable across reloads. Shape follows the token's story: strong scores
  trend with a breakout leg; weak scores pump and bleed. Replaced by real
  OHLC when live data ships.
*/
export type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SeriesBundle = {
  candles: Candle[];
  liquidity: { time: number; value: number }[];
  buys: number;
  sells: number;
  topHolders: { label: string; pct: number }[];
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function buildSeries(opts: {
  address: string;
  score: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  topShare?: number; // 0..1 top-10 share, optional
}): SeriesBundle {
  const rnd = mulberry32(hashSeed(opts.address));
  const N = 96; // 24h of 15m candles
  const step = 15 * 60;
  const now = Math.floor(Date.now() / 1000);
  const start = now - N * step;

  // base price from mcap (assume 1B supply for display purposes)
  let price = Math.max(opts.marketCapUsd / 1_000_000_000, 0.000001);
  const strong = opts.score >= 70;
  const weak = opts.score < 40;

  // drift per candle: strong tokens trend up, weak pump early then bleed
  const candles: Candle[] = [];
  const liquidity: { time: number; value: number }[] = [];
  let liq = opts.liquidityUsd * (weak ? 1.6 : 0.55);

  for (let i = 0; i < N; i++) {
    const t = start + i * step;
    const progress = i / N;

    let drift: number;
    if (strong) {
      // gentle chop, breakout in the last quarter
      drift = progress > 0.72 ? 0.012 : 0.0006;
    } else if (weak) {
      // early pump, long bleed
      drift = progress < 0.18 ? 0.02 : -0.009;
    } else {
      drift = progress > 0.5 ? 0.002 : -0.001;
    }

    const vol = 0.02 + rnd() * 0.025;
    const open = price;
    const change = drift + (rnd() - 0.5) * vol;
    const close = Math.max(open * (1 + change), 0.0000001);
    const high = Math.max(open, close) * (1 + rnd() * vol * 0.6);
    const low = Math.min(open, close) * (1 - rnd() * vol * 0.6);
    const volume =
      opts.liquidityUsd * (0.02 + rnd() * 0.08) * (strong && progress > 0.72 ? 2.6 : 1) *
      (weak && progress < 0.18 ? 3 : 1);

    candles.push({ time: t, open, high, low, close, volume });
    price = close;

    // liquidity drifts toward the current figure
    const target = opts.liquidityUsd * (weak ? 1 - progress * 0.55 : 0.55 + progress * 0.45);
    liq += (target - liq) * 0.12 + (rnd() - 0.5) * opts.liquidityUsd * 0.01;
    liquidity.push({ time: t, value: Math.max(liq, 1000) });
  }

  // buy/sell pressure over the last hour, aligned with the trend
  const base = 80 + Math.floor(rnd() * 240);
  const ratio = strong ? 0.62 + rnd() * 0.12 : weak ? 0.3 + rnd() * 0.1 : 0.48 + rnd() * 0.08;
  const buys = Math.round(base * ratio);
  const sells = base - buys;

  // top holders: constrained by top-10 share when known
  const topShare = opts.topShare ?? (weak ? 0.42 : 0.18 + rnd() * 0.1);
  const topHolders: { label: string; pct: number }[] = [];
  let remaining = topShare * 100;
  for (let i = 0; i < 10; i++) {
    const slice = i === 9 ? remaining : (remaining * (0.32 + rnd() * 0.2)) / (i < 3 ? 1 : 2);
    const pct = Math.max(Math.round(slice * 10) / 10, 0.1);
    topHolders.push({ label: `#${i + 1}`, pct });
    remaining = Math.max(remaining - pct, 0);
  }

  return { candles, liquidity, buys, sells, topHolders };
}

export function pctChange24h(candles: Candle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0].open;
  const last = candles[candles.length - 1].close;
  return ((last - first) / first) * 100;
}

export function lastPrice(candles: Candle[]): number {
  return candles.length ? candles[candles.length - 1].close : 0;
}

export function priceFmt(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "$0";
  if (p >= 1) return "$" + p.toFixed(2);
  if (p >= 0.01) return "$" + p.toFixed(4);
  if (p >= 0.000001) return "$" + p.toFixed(7).replace(/0+$/, "").padEnd(6, "0");
  // memecoin territory: compress leading zeros, e.g. $0.0{8}1234
  const s = p.toFixed(20);
  const m = s.match(/^0\.(0+)([1-9]\d{0,3})/);
  if (!m) return "$" + p.toExponential(2);
  return `$0.0{${m[1].length}}${m[2]}`;
}
