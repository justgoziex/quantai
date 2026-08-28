import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EthLogo, BnbLogo } from "@/components/brand/chain-logo";

/*
  CTA band — a dark Ethereum network render as a full-bleed strip under a
  solid ink scrim (flat overlay, no gradient). One headline, one action.
*/
export function Cta() {
  return (
    <section className="relative overflow-hidden border-b border-line bg-ink">
      <Image
        src="/img/eth-network.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-right"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-ink/72" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-wrap flex-col items-start gap-7 px-6 py-24 lg:py-32">
        <div className="flex items-center gap-2">
          <EthLogo size={18} brand />
          <BnbLogo size={18} brand />
          <span className="font-mono text-data-sm uppercase tracking-[0.14em] text-bone/60">
            Ethereum · BNB Chain
          </span>
        </div>
        <h2 className="text-display-lg max-w-xl text-bone" style={{ textWrap: "balance" }}>
          The next pair launches in seconds. Be reading it, not refreshing it.
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <Button size="lg" asChild>
            <Link href="/screener">Start screening free</Link>
          </Button>
          <span className="font-mono text-data-sm text-bone/60">
            No keys custodied · cancel anytime
          </span>
        </div>
      </div>
    </section>
  );
}
