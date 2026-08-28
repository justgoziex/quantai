"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

/*
  Watchlist toggle — optimistic; signed-out clicks route to /signin.
  Parent owns the watched set so table state stays consistent.
*/
export function WatchStar({
  tokenId,
  watched,
  onToggle,
}: {
  tokenId: string;
  watched: boolean;
  onToggle: (tokenId: string, next: boolean) => void;
}) {
  const { authenticated, getToken } = useAuth();
  const router = useRouter();

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!authenticated) {
      router.push("/signin");
      return;
    }
    const next = !watched;
    onToggle(tokenId, next); // optimistic
    try {
      const token = await getToken();
      const r = await fetch("/api/watchlist", {
        method: next ? "POST" : "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ tokenId }),
      });
      if (!r.ok) onToggle(tokenId, !next); // revert
    } catch {
      onToggle(tokenId, !next);
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={watched}
      className={cn(
        "rounded p-1 transition-colors duration-fast",
        watched ? "text-amber" : "text-faint hover:text-muted",
      )}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
        <path
          d="M8 1.5l1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.3l-3.9 2.2.9-4.4-3.3-3 4.4-.5L8 1.5z"
          fill={watched ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
