"use client";

import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

/*
  Quick-buy from the screener. A one-tap preset picks an amount and opens the
  token's trade panel pre-filled to BUY (via ?buy=), so the wallet confirm is
  the very next step — no digging into the page first.
*/
const PRESETS: Record<string, string[]> = {
  ETH: ["0.05", "0.1", "0.25"],
  BSC: ["0.2", "0.5", "1"],
  RH: ["0.05", "0.1", "0.25"],
};

export function QuickBuy({ chain, address }: { chain: string; address: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const gas = chain === "BSC" ? "BNB" : "ETH";
  const presets = PRESETS[chain] ?? PRESETS.ETH;

  const go = (amt: string) => router.push(`/token/${chain.toLowerCase()}/${address}?buy=${amt}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="rounded border border-gain/40 px-2.5 py-1 font-mono text-data-sm text-gain transition-colors duration-fast hover:bg-gain/10"
          title={t("Quick buy")}
        >
          {t("Buy")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {presets.map((a) => (
          <DropdownMenuItem key={a} onSelect={() => go(a)} className="font-mono text-data-sm">
            {a} {gas}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => go("")} className="text-muted">
          {t("Custom")}…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
