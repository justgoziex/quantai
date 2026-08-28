"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { WatchStar } from "@/components/product/watch-star";

/* Self-contained watch toggle for the detail header. */
export function TokenWatch({ tokenId }: { tokenId: string }) {
  const { ready, authenticated, getToken } = useAuth();
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    (async () => {
      try {
        const token = await getToken();
        const r = await fetch("/api/watchlist", { headers: { authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const data = (await r.json()) as { watchlist: { tokenId: string }[] };
        setWatched(data.watchlist.some((w) => w.tokenId === tokenId));
      } catch {
        /* non-blocking */
      }
    })();
  }, [ready, authenticated, getToken, tokenId]);

  return (
    <span className="rounded border border-line p-1.5">
      <WatchStar tokenId={tokenId} watched={watched} onToggle={(_, next) => setWatched(next)} />
    </span>
  );
}
