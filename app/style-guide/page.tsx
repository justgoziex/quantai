import type { Metadata } from "next";
import { Mark, Wordmark, Lockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalScore } from "@/components/product/signal-score";
import { EmptyState } from "@/components/product/empty-state";
import { InteractiveDemos } from "./interactive";

export const metadata: Metadata = { title: "Style guide" };

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-b border-line py-12">
      <div className="mb-8 flex items-baseline justify-between gap-6">
        <h2 className="text-h1 text-bone">{title}</h2>
        {note ? <p className="hidden max-w-md text-right text-xs text-muted sm:block">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, cssVar, hex, on }: { name: string; cssVar: string; hex: string; on?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 rounded border border-line"
        style={{ background: `hsl(var(${cssVar}))` }}
      />
      <div>
        <p className="text-sm text-bone">{name}</p>
        <p className="font-mono text-data-sm text-muted">
          {hex} · {cssVar}
        </p>
        {on ? <p className="font-mono text-data-sm text-faint">accent — the only one</p> : null}
      </div>
    </div>
  );
}

const sampleRows = [
  { token: "PEPEX", pair: "PEPEX / WETH", age: "14m", liq: "$182K", mcap: "$1.2M", score: 82, badges: [{ v: "gain", t: "LP locked" }, { v: "bone", t: "Verified" }] },
  { token: "MOGUL", pair: "MOGUL / WETH", age: "1h 02m", liq: "$94K", mcap: "$640K", score: 57, badges: [{ v: "bone", t: "Verified" }, { v: "warn", t: "Top 10 hold 31%" }] },
  { token: "DRIP", pair: "DRIP / WETH", age: "3h 40m", liq: "$21K", mcap: "$88K", score: 24, badges: [{ v: "loss", t: "Honeypot risk" }, { v: "loss", t: "Mint open" }] },
] as const;

export default function StyleGuide() {
  return (
    <main className="mx-auto max-w-wrap px-6 pb-24">
      {/* header */}
      <header className="border-b border-line pb-10 pt-16">
        <p className="text-label mb-4">Quant AI · Design System · v1</p>
        <h1 className="text-display-lg mb-4 text-bone" style={{ textWrap: "balance" }}>
          Precision is the aesthetic.
        </h1>
        <p className="max-w-xl text-base text-muted">
          One accent, hairline borders, tabular numerals, small radii. Everything below is
          built from the tokens — no component carries its own colors. The 45° breakout
          line from the mark is the system&rsquo;s only recurring gesture.
        </p>
      </header>

      {/* brand */}
      <Section id="brand" title="Brand" note="The mark inherits currentColor for the ring; the tail stays amber. Never gradient, never rotated.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex h-36 items-center justify-center">
              <Mark size={64} className="text-bone" />
            </CardContent>
            <CardFooter className="text-label">Mark</CardFooter>
          </Card>
          <Card>
            <CardContent className="flex h-36 items-center justify-center">
              <Wordmark className="text-[26px]" />
            </CardContent>
            <CardFooter className="text-label">Wordmark</CardFooter>
          </Card>
          <Card>
            <CardContent className="flex h-36 items-center justify-center">
              <Lockup markSize={30} />
            </CardContent>
            <CardFooter className="text-label">Lockup</CardFooter>
          </Card>
        </div>
      </Section>

      {/* color */}
      <Section id="color" title="Color" note="Ground and type are warm greys biased toward the amber. Gain/loss are semantic only — they never decorate.">
        <div className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          <Swatch name="Ink" cssVar="--ink" hex="#0A0A09" />
          <Swatch name="Panel" cssVar="--panel" hex="#121211" />
          <Swatch name="Raised" cssVar="--raised" hex="#181713" />
          <Swatch name="Line" cssVar="--line" hex="#262521" />
          <Swatch name="Line strong" cssVar="--line-strong" hex="#363430" />
          <Swatch name="Bone" cssVar="--bone" hex="#E9E6DD" />
          <Swatch name="Muted" cssVar="--muted" hex="#8B877C" />
          <Swatch name="Faint" cssVar="--faint" hex="#5C5952" />
          <Swatch name="Signal Amber" cssVar="--amber" hex="#EEA02B" on />
          <Swatch name="Amber deep" cssVar="--amber-deep" hex="#BF7A18" />
        </div>
        <div className="grid grid-cols-2 gap-6 sm:max-w-md sm:grid-cols-2">
          <Swatch name="Gain" cssVar="--gain" hex="#52B879" />
          <Swatch name="Loss" cssVar="--loss" hex="#DD4B3E" />
        </div>
      </Section>

      {/* type */}
      <Section id="type" title="Typography" note="Geist for everything; Geist Mono for labels and data. Display sizes tighten tracking as they grow.">
        <div className="flex flex-col gap-7">
          <div>
            <p className="text-label mb-2">display-2xl · Geist 600 · −3%</p>
            <p className="text-display-2xl text-bone">Exit before the crowd.</p>
          </div>
          <div>
            <p className="text-label mb-2">display-lg · Geist 600 · −2.5%</p>
            <p className="text-display-lg text-bone">Every pair, scored in seconds</p>
          </div>
          <div>
            <p className="text-label mb-2">h1 / h2 / h3</p>
            <div className="flex flex-col gap-1.5">
              <p className="text-h1 text-bone">Token screener</p>
              <p className="text-h2 text-bone">Holder distribution</p>
              <p className="text-h3 text-bone">Liquidity events</p>
            </div>
          </div>
          <div className="max-w-xl">
            <p className="text-label mb-2">base body · 15/1.6</p>
            <p className="text-base text-muted">
              Signals are rule-based scores computed from on-chain data — liquidity depth,
              holder concentration, contract flags, and momentum. They are analytics, not
              advice; a high score is a reading, never a promise.
            </p>
          </div>
          <div>
            <p className="text-label mb-2">data / mono · tabular-nums</p>
            <p className="font-mono text-data-lg tabular text-bone">
              0.0421 ETH · +38.2% · $1,204,118
            </p>
          </div>
        </div>
      </Section>

      {/* buttons + forms (interactive client island) */}
      <Section id="controls" title="Controls" note="Primary is the only filled surface in the system. Everything else is hairline + text.">
        <InteractiveDemos />
      </Section>

      {/* badges */}
      <Section id="badges" title="Risk badges" note="Mono, uppercase, quiet. Color states are semantic and earn their hue.">
        <div className="flex flex-wrap gap-2.5">
          <Badge variant="bone">Verified contract</Badge>
          <Badge variant="gain">LP locked 180d</Badge>
          <Badge variant="amber">Score 82</Badge>
          <Badge variant="warn">Top 10 hold 31%</Badge>
          <Badge variant="loss">Honeypot risk</Badge>
          <Badge variant="loss">Mint authority open</Badge>
          <Badge>Unverified</Badge>
        </div>
      </Section>

      {/* signal score */}
      <Section id="score" title="Signal score" note="Segmented meter — flat solids, tier encoded in color. ≥70 amber, 40–69 bone, <40 muted.">
        <div className="flex flex-col gap-5">
          <SignalScore score={82} />
          <SignalScore score={57} />
          <SignalScore score={24} />
          <div className="flex items-center gap-6 border-t border-line pt-4">
            <span className="text-label">compact</span>
            <SignalScore score={82} size="sm" />
            <SignalScore score={57} size="sm" />
            <SignalScore score={24} size="sm" />
          </div>
        </div>
      </Section>

      {/* table */}
      <Section id="table" title="Data table" note="Hairline dividers, mono headers, tabular numerals right-aligned. Rows lift one surface on hover.">
        <Card>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Token</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Liquidity</TableHead>
                <TableHead className="text-right">MCap</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="text-right">Signal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sampleRows.map((r) => (
                <TableRow key={r.token}>
                  <TableCell>
                    <p className="font-medium text-bone">{r.token}</p>
                    <p className="font-mono text-data-sm text-muted">{r.pair}</p>
                  </TableCell>
                  <TableCell className="font-mono text-data text-muted">{r.age}</TableCell>
                  <TableCell className="text-right font-mono text-data text-bone">{r.liq}</TableCell>
                  <TableCell className="text-right font-mono text-data text-bone">{r.mcap}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {r.badges.map((b) => (
                        <Badge key={b.t} variant={b.v as never}>{b.t}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <SignalScore score={r.score} size="sm" className="justify-end" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      {/* cards */}
      <Section id="cards" title="Cards" note="Panels sit one step above ink. Headers and footers separate with hairlines, not weight.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Buy pressure</CardTitle>
              <CardDescription>Last 15 minutes · WETH pair</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-data-lg tabular text-gain">+64.8%</p>
              <p className="mt-1 text-xs text-muted">412 buys vs 148 sells</p>
            </CardContent>
            <CardFooter className="text-label">Updated 12s ago</CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Watchlist</CardTitle>
              <CardDescription>Signals you follow</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {["PEPEX · 82", "MOGUL · 57"].map((t) => (
                <div key={t} className="flex items-center justify-between border-b border-line pb-2.5 last:border-0 last:pb-0">
                  <span className="font-mono text-data text-bone">{t}</span>
                  <Badge variant="amber">Active</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </Section>

      {/* skeletons */}
      <Section id="skeleton" title="Loading" note="Skeletons are shaped like the real content — a screener row, not a grey box.">
        <Card>
          <div className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0">
                <div className="flex-1">
                  <Skeleton className="mb-1.5 h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="hidden h-4 w-24 sm:block" />
                <Skeleton className="h-3.5 w-20" />
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* empty state */}
      <Section id="empty" title="Empty state" note="The hatched strip is the 45° gesture. One label, one line, one action.">
        <EmptyState
          label="Watchlist"
          title="Nothing tracked yet"
          description="Add a token from the screener."
          action={<Button variant="secondary">Open screener</Button>}
        />
      </Section>

      {/* motion */}
      <Section id="motion" title="Motion" note="Functional only: 120/180/260ms on a precise ease. No scroll-triggered text reveals, ever.">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { name: "fast · 120ms", desc: "hover states, presses, toggles" },
            { name: "base · 180ms", desc: "tooltips, dropdowns, row entrances" },
            { name: "slow · 260ms", desc: "panels, charts redrawing, page-level shifts" },
          ].map((m) => (
            <Card key={m.name}>
              <CardContent className="py-4">
                <p className="font-mono text-data mb-1 text-bone">{m.name}</p>
                <p className="text-xs text-muted">{m.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-4 font-mono text-data-sm text-faint">
          ease-precise: cubic-bezier(0.32, 0.72, 0, 1) · ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1)
        </p>
      </Section>
    </main>
  );
}
