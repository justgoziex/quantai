import { Marquee } from "@/components/motion/marquee";
import { cn } from "@/lib/utils";

/*
  Tape — exchange-style ticker of recent scores. Mono, hairline-bounded,
  pauses on hover. Pure texture with real shape: token · score · move.
*/
const ITEMS = [
  { t: "PEPEX", c: "ETH", s: 82, d: "+38.2%", up: true },
  { t: "NOCTA", c: "ETH", s: 78, d: "+12.4%", up: true },
  { t: "FUME", c: "ETH", s: 71, d: "+6.1%", up: true },
  { t: "SABLE", c: "BSC", s: 64, d: "-2.3%", up: false },
  { t: "MOGUL", c: "BSC", s: 57, d: "+0.8%", up: true },
  { t: "KILN", c: "ETH", s: 44, d: "-11.7%", up: false },
  { t: "DRIP", c: "BSC", s: 24, d: "-44.9%", up: false },
  { t: "VELD", c: "BSC", s: 76, d: "+21.6%", up: true },
];

export function Tape() {
  return (
    <div className="border-b border-line" aria-hidden="true">
      <Marquee duration="56s" className="py-2.5">
        {ITEMS.map((i) => (
          <span
            key={i.t}
            className="flex items-center gap-2.5 whitespace-nowrap px-6 font-mono text-data-sm"
          >
            <span className="text-bone">{i.t}</span>
            <span className="text-faint">{i.c}</span>
            <span className="text-muted">SCORE {i.s}</span>
            <span className={cn(i.up ? "text-gain" : "text-loss")}>{i.d}</span>
            <span className="pl-5 text-line-strong">/</span>
          </span>
        ))}
      </Marquee>
    </div>
  );
}
