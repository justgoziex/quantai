"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/* Re-render the (server-rendered) status page every 30s so it stays live. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
