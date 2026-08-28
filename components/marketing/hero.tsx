"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { EthLogo, BnbLogo, SolLogo } from "@/components/brand/chain-logo";
import { ScreenerPreview } from "./screener-preview";

/*
  Hero — the product is the visual. One staggered entrance on load
  (never re-triggered on scroll), then the preview simply behaves.
*/
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 1, 0.5, 1] } },
};

export function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-wrap items-center gap-12 px-6 py-16 lg:grid-cols-[7fr_5fr] lg:gap-16 lg:py-24">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.p variants={item} className="mb-5 flex items-center gap-2 text-label">
            <EthLogo size={15} brand />
            <BnbLogo size={15} brand />
            <SolLogo size={15} brand />
            <span>Solana + Ethereum + BNB memecoins · rule-based scoring</span>
          </motion.p>
          <motion.h1
            variants={item}
            className="text-display-xl mb-6 text-bone md:text-display-2xl"
            style={{ textWrap: "balance" }}
          >
            See the breakout before the crowd does.
          </motion.h1>
          <motion.p variants={item} className="mb-8 max-w-lg text-base text-muted">
            Quant AI watches every new pair on Solana, Ethereum and BNB Chain, runs ten
            on-chain risk gates, and scores each token 0–100 with the reasoning
            spelled out in plain English. Signals, not promises — you stay in
            control.
          </motion.p>
          <motion.div variants={item} className="flex flex-wrap items-center gap-4">
            <Button size="lg" asChild>
              <Link href="/screener">Start screening</Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <a href="#signals">How scoring works</a>
            </Button>
          </motion.div>
          <motion.p variants={item} className="mt-6 font-mono text-data-sm text-faint">
            Solana + Ethereum + BNB Chain · free to start
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.35, ease: [0.25, 1, 0.5, 1] }}
        >
          <ScreenerPreview />
        </motion.div>
      </div>
    </section>
  );
}
