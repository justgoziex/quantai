"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/*
  Keeps a token detail page live: every 30s, refresh this token from live
  sources server-side, then re-render the server components in place.
*/
export function LiveRefresh({ chain, address }: { chain: string; address: string }) {
  const router = useRouter();

  useEffect(() => {
    const tick = async () => {
      try {
        await fetch(`/api/refresh/${chain}/${address}`, { method: "POST" });
        router.refresh();
      } catch {
        /* next tick retries */
      }
    };
    /*
      Refresh immediately, then on an interval. Waiting for the first tick
      meant the page you just opened showed whatever was last stored — which
      on a token nobody had viewed in hours was hours old.
    */
    void tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [chain, address, router]);

  return null;
}
