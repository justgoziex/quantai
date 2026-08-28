import type { Config } from "tailwindcss";

/*
  Quant AI — design tokens.
  One accent (signal amber), bone on ink, hairline borders, small radii.
  All colors reference CSS vars in globals.css so future theming stays token-level.
*/
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      ink: "hsl(var(--ink))",
      panel: "hsl(var(--panel))",
      raised: "hsl(var(--raised))",
      line: {
        DEFAULT: "hsl(var(--line))",
        strong: "hsl(var(--line-strong))",
      },
      bone: "hsl(var(--bone))",
      muted: "hsl(var(--muted))",
      faint: "hsl(var(--faint))",
      amber: {
        DEFAULT: "hsl(var(--amber))",
        deep: "hsl(var(--amber-deep))",
        ink: "hsl(var(--amber-ink))",
      },
      gain: "hsl(var(--gain))",
      loss: "hsl(var(--loss))",
      warn: "hsl(var(--warn))",
    },
    fontFamily: {
      sans: ["var(--font-geist)", "system-ui", "sans-serif"],
      mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
    },
    fontSize: {
      // display — tight tracking, for marketing/hero surfaces
      "display-2xl": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "600" }],
      "display-xl": ["2.75rem", { lineHeight: "1.08", letterSpacing: "-0.028em", fontWeight: "600" }],
      "display-lg": ["2rem", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "600" }],
      // headings — product surfaces
      h1: ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.02em", fontWeight: "600" }],
      h2: ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.015em", fontWeight: "600" }],
      h3: ["0.9375rem", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "600" }],
      // body
      base: ["0.9375rem", { lineHeight: "1.6" }],
      sm: ["0.8125rem", { lineHeight: "1.55" }],
      xs: ["0.75rem", { lineHeight: "1.5" }],
      // data — mono contexts
      "data-lg": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      data: ["0.8125rem", { lineHeight: "1.4" }],
      "data-sm": ["0.6875rem", { lineHeight: "1.4" }],
    },
    extend: {
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "2px",
        md: "6px",
        lg: "8px",
      },
      maxWidth: {
        wrap: "1120px",
      },
      transitionTimingFunction: {
        "out-quart": "var(--ease-out-quart)",
        precise: "var(--ease-precise)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "260ms",
      },
      keyframes: {
        "skeleton-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--marquee-gap, 2rem)))" },
        },
        "live-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "skeleton-pulse": "skeleton-pulse 1.6s var(--ease-precise) infinite",
        "rise-in": "rise-in 180ms var(--ease-out-quart) both",
        marquee: "marquee var(--marquee-duration, 40s) linear infinite",
        "live-pulse": "live-pulse 2s var(--ease-precise) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
