import { cn } from "@/lib/utils";

/*
  Signal Q — the mark is drawn inline so it inherits currentColor for the ring
  and can recolor the breakout tail. Geometry is canonical (brand/final/svg).
*/
export function Mark({
  size = 28,
  className,
  tailClassName = "text-amber",
}: {
  size?: number;
  className?: string;
  tailClassName?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Quant AI"
    >
      <path
        d="M 37.45 47.13 A 20 20 0 1 1 47.13 37.45"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
      />
      <path
        d="M25.5 25.5 L55.5 55.5"
        stroke="currentColor"
        strokeWidth="7"
        className={tailClassName}
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap font-sans text-[17px] font-semibold tracking-[-0.015em] text-bone",
        className,
      )}
    >
      QUANT <span className="text-amber">AI</span>
    </span>
  );
}

export function Lockup({
  markSize = 26,
  className,
}: {
  markSize?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={markSize} className="text-bone" />
      <Wordmark />
    </span>
  );
}
