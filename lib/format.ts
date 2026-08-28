/* Shared display formatting — terminal-style, tabular-friendly. */

export function usdCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
}

/*
  A holder count reads exactly 1,000 when the source stopped at a page rather
  than because the token has precisely that many holders. Presenting a floor
  as an exact figure is the kind of small dishonesty people notice once and
  then stop trusting the rest of the numbers, so the cap is shown as "1K+".
*/
export const HOLDER_PAGE_CAP = 1_000;

export function countCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n === HOLDER_PAGE_CAP) return "1K+";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/* "41s" · "14m" · "1h 02m" · "3d 4h" */
export function age(from: Date | string | null | undefined): string {
  if (!from) return "—";
  const ms = Date.now() - new Date(from).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h " + String(m % 60).padStart(2, "0") + "m";
  const d = Math.floor(h / 24);
  return d + "d " + (h % 24) + "h";
}

export function timeAgo(from: Date | string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  return Math.floor(m / 60) + "h ago";
}
