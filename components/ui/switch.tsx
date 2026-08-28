"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-fast ease-precise",
      "border-line-strong bg-panel data-[state=checked]:border-amber data-[state=checked]:bg-amber",
      "disabled:cursor-not-allowed disabled:opacity-40",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-3 w-3 rounded-full transition-transform duration-fast ease-precise",
        "translate-x-[3px] bg-muted data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-ink",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
