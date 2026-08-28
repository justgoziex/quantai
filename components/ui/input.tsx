import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 16px on touch screens so iOS doesn't zoom on focus; 14px from sm up
          "flex h-9 w-full rounded border border-line bg-panel px-3 text-[16px] text-bone sm:h-8 sm:text-sm",
          "placeholder:text-faint",
          "transition-colors duration-fast ease-precise",
          "hover:border-line-strong",
          "focus:border-amber focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-40",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
