import { readFileSync } from "node:fs";

const m = readFileSync("/tmp/g1.txt", "utf8").match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
process.env.DATABASE_URL = m![1].trim().replace(/^["']|["']$/g, "");

const { PrismaClient } = await import("./lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

for (const chain of ["SOL", "ETH"] as const) {
  const top = await p.token.findMany({
    where: { chain, blacklisted: false },
    orderBy: { currentScore: "desc" },
    take: 3,
    select: { symbol: true, currentScore: true, flags: true, gateBreakdown: true, holders: true, liquidityUsd: true },
  });
  console.log(`\n=== ${chain} top scorers ===`);
  for (const t of top) {
    const g = (t.gateBreakdown ?? {}) as Record<string, number>;
    const sum = Object.entries(g).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`  ${t.symbol.slice(0, 14).padEnd(14)} ${String(t.currentScore).padStart(3)}  holders=${t.holders}  liq=$${Math.round(t.liquidityUsd).toLocaleString()}`);
    console.log(`     gates: ${sum || "(none)"}`);
    console.log(`     flags: ${t.flags.join(",") || "(none)"}`);
  }
}

// how many Solana tokens have a FULL read (security present) vs rug-tier
const solFull = await p.token.count({
  where: { chain: "SOL", NOT: { flags: { hasSome: ["SCREENING", "RUGCHECKED", "UNVERIFIED"] } } },
});
const solHolders = await p.token.count({ where: { chain: "SOL", holders: { gt: 0 } } });
console.log(`\nSOL with full ten-gate read : ${solFull}`);
console.log(`SOL with a holder count     : ${solHolders}`);
await p.$disconnect();
