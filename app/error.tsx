"use client";

import { Mark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/* App-level error boundary — branded, with a working recovery path. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Mark size={40} className="text-faint" tailClassName="text-loss" />
      <div>
        <p className="text-label mb-3">Error</p>
        <h1 className="text-display-lg mb-2 text-bone">Something broke on our side</h1>
        <p className="max-w-sm text-sm text-muted">
          The page hit an unexpected error. Retry usually clears it — if it
          keeps happening, the status page will say why.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-data-sm text-faint">ref {error.digest}</p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button onClick={reset}>Retry</Button>
        <Button variant="secondary" asChild>
          <a href="/">Back home</a>
        </Button>
      </div>
    </main>
  );
}
