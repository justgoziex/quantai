import { cn } from "@/lib/utils";

/*
  Marquee — infinite tape (Magic UI structural pattern, flat brand styling).
  Content is duplicated once; CSS keyframe translates the full width.
  Respects prefers-reduced-motion via the motion-safe gate.
*/
export function Marquee({
  children,
  duration = "48s",
  className,
}: {
  children: React.ReactNode;
  duration?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("group flex overflow-hidden", className)}
      style={{ "--marquee-duration": duration, "--marquee-gap": "0px" } as React.CSSProperties}
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden={i === 1}
          className="flex shrink-0 items-center motion-safe:animate-marquee group-hover:[animation-play-state:paused]"
        >
          {children}
        </div>
      ))}
    </div>
  );
}
