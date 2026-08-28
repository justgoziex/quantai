import { cn } from "@/lib/utils";

/*
  SignalScore — the composite 0–100 score, rendered as a segmented meter.
  Segments are flat solids (no gradient); tier is encoded in color:
    ≥ 70 amber (strong signal) · 40–69 bone (neutral) · < 40 muted (weak).
  Always framed as a score, never a guarantee.
*/
const SEGMENTS = 20;

export function tierOf(score: number): "strong" | "neutral" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 40) return "neutral";
  return "weak";
}

const tierText = {
  strong: "text-amber",
  neutral: "text-bone",
  weak: "text-muted",
} as const;

const tierFill = {
  strong: "bg-amber",
  neutral: "bg-bone",
  weak: "bg-muted",
} as const;

export function SignalScore({
  score,
  size = "default",
  className,
}: {
  score: number;
  size?: "sm" | "default";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const filled = Math.round((clamped / 100) * SEGMENTS);
  const tier = tierOf(clamped);

  return (
    <div
      className={cn("inline-flex items-center", size === "sm" ? "gap-2" : "gap-3", className)}
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Signal score ${clamped} of 100`}
    >
      <span
        className={cn(
          "font-mono tabular",
          size === "sm" ? "text-data" : "text-data-lg",
          tierText[tier],
        )}
      >
        {clamped}
      </span>
      <div className={cn("flex", size === "sm" ? "gap-px" : "gap-0.5")} aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={cn(
              size === "sm" ? "h-2.5 w-0.5" : "h-4 w-1",
              i < filled ? tierFill[tier] : "bg-line",
            )}
          />
        ))}
      </div>
    </div>
  );
}
