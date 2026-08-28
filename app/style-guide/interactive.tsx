"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { SignalScore } from "@/components/product/signal-score";

export function InteractiveDemos() {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-10">
        {/* buttons */}
        <div>
          <p className="text-label mb-3">Buttons</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Track token</Button>
            <Button variant="secondary">Open screener</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="destructive">Remove wallet</Button>
            <Button variant="link">View contract</Button>
            <Button disabled>Track token</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="default" variant="secondary">Default</Button>
            <Button size="lg" variant="secondary">Large</Button>
          </div>
        </div>

        {/* form row */}
        <div>
          <p className="text-label mb-3">Form</p>
          <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-min-liq">Min liquidity (USD)</Label>
              <Input id="sg-min-liq" placeholder="50,000" inputMode="numeric" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-contract">Contract address</Label>
              <Input id="sg-contract" placeholder="0x…" className="font-mono text-data" />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-8">
            <label className="flex items-center gap-2.5 text-sm text-bone">
              <Switch defaultChecked aria-label="Only LP locked" /> Only LP locked
            </label>
            <label className="flex items-center gap-2.5 text-sm text-bone">
              <Checkbox defaultChecked aria-label="Verified contracts" /> Verified contracts
            </label>
            <label className="flex items-center gap-2.5 text-sm text-muted">
              <Checkbox aria-label="Include honeypot flagged" /> Include flagged
            </label>
          </div>
        </div>

        {/* tabs */}
        <div>
          <p className="text-label mb-3">Tabs</p>
          <Tabs defaultValue="signals" className="max-w-2xl">
            <TabsList>
              <TabsTrigger value="signals">Signals</TabsTrigger>
              <TabsTrigger value="holders">Holders</TabsTrigger>
              <TabsTrigger value="trades">Trades</TabsTrigger>
            </TabsList>
            <TabsContent value="signals" className="text-sm text-muted">
              Entry and exit callouts with plain-English reasoning land here.
            </TabsContent>
            <TabsContent value="holders" className="text-sm text-muted">
              Distribution, concentration, and fresh-wallet ratio.
            </TabsContent>
            <TabsContent value="trades" className="text-sm text-muted">
              Live buys and sells with size and maker.
            </TabsContent>
          </Tabs>
        </div>

        {/* tooltip — the score-breakdown pattern */}
        <div>
          <p className="text-label mb-3">Tooltip — score breakdown</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="inline-flex rounded" aria-label="Show score breakdown">
                <SignalScore score={82} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="mb-2 font-medium text-bone">Score 82 · Strong</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 font-mono text-data-sm text-muted">
                <dt>Liquidity depth</dt><dd className="text-bone">+24</dd>
                <dt>LP lock 180d</dt><dd className="text-bone">+20</dd>
                <dt>Holder spread</dt><dd className="text-bone">+18</dd>
                <dt>Buy momentum</dt><dd className="text-bone">+14</dd>
                <dt>Contract flags</dt><dd className="text-bone">+6</dd>
              </dl>
              <p className="mt-2 border-t border-line pt-2 text-faint">
                A score, not a guarantee.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
