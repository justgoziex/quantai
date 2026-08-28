"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/*
  NumberTicker — count-up on first view (Magic UI pattern, rebuilt on tokens).
  Spring-driven so large values decelerate into place instead of easing linearly.
*/
export function NumberTicker({
  value,
  decimalPlaces = 0,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 34, stiffness: 90 });
  const isInView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });

  useEffect(() => {
    if (isInView) motionValue.set(value);
  }, [isInView, value, motionValue]);

  useEffect(
    () =>
      spring.on("change", (latest: number) => {
        if (ref.current) {
          ref.current.textContent =
            prefix +
            Intl.NumberFormat("en-US", {
              minimumFractionDigits: decimalPlaces,
              maximumFractionDigits: decimalPlaces,
            }).format(Number(latest.toFixed(decimalPlaces))) +
            suffix;
        }
      }),
    [spring, decimalPlaces, prefix, suffix],
  );

  return (
    <span ref={ref} className={cn("tabular", className)}>
      {prefix}0{suffix}
    </span>
  );
}
