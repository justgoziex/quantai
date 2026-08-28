import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-data-sm uppercase tracking-[0.08em]",
  {
    variants: {
      variant: {
        neutral: "border-line text-muted",
        bone: "border-line-strong text-bone",
        amber: "border-amber/40 bg-amber/10 text-amber",
        gain: "border-gain/40 bg-gain/10 text-gain",
        loss: "border-loss/40 bg-loss/10 text-loss",
        warn: "border-warn/40 bg-warn/10 text-warn",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
