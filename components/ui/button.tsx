import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium",
    "transition-all duration-fast ease-precise select-none",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-amber text-amber-ink hover:bg-[hsl(36_85%_60%)] " +
          "shadow-[inset_0_-1px_0_hsl(var(--amber-deep))]",
        secondary:
          "border border-line-strong bg-transparent text-bone hover:bg-raised hover:border-faint",
        ghost: "text-muted hover:text-bone hover:bg-raised",
        destructive:
          "border border-loss/40 bg-transparent text-loss hover:bg-loss/10 hover:border-loss",
        link: "text-amber underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        default: "h-8 px-3.5 text-sm",
        lg: "h-10 px-5 text-base",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
