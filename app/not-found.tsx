import Link from "next/link";
import { Mark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Mark size={40} className="text-faint" tailClassName="text-faint" />
      <div>
        <p className="text-label mb-3">404</p>
        <h1 className="text-display-lg mb-2 text-bone">No signal here</h1>
        <p className="max-w-sm text-sm text-muted">
          This page doesn&rsquo;t exist — or it moved. The screener is where
          everything starts.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/">Back home</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/screener">Open screener</Link>
        </Button>
      </div>
    </main>
  );
}
