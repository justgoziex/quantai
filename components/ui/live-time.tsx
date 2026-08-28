"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

/*
  Self-ticking relative time — re-renders on an interval so "13s ago" becomes
  "1m ago", "1h ago", etc. without a page refresh. Ticks fast when the value
  is fresh, slower once it's minutes/hours old.
*/
export function LiveTimeAgo({ date, prefix = "" }: { date: string | Date; prefix?: string }) {
  const [, force] = useState(0);
  const ageMs = Date.now() - new Date(date).getTime();

  useEffect(() => {
    const interval = ageMs < 60_000 ? 5_000 : ageMs < 3_600_000 ? 30_000 : 300_000;
    const t = setInterval(() => force((n) => n + 1), interval);
    return () => clearInterval(t);
  }, [ageMs]);

  return (
    <span suppressHydrationWarning>
      {prefix}
      {timeAgo(date)}
    </span>
  );
}
