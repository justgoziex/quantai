import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const now = Date.now();
const min = (n: number) => new Date(now - n * 60_000);

const TOKENS = [
  {
    chain: "ETH", address: "0xa1c3f09f2e6d4b7a90cc2b1e8d5f16a2b3c4d5e6", name: "Pepex", symbol: "PEPEX",
    pairAddress: "0x11a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0", dex: "Uniswap v2",
    liquidityUsd: 182_000, marketCapUsd: 1_200_000, holders: 1841, pairCreatedAt: min(14),
    currentScore: 82, flags: ["LP_LOCKED", "VERIFIED"],
    gateBreakdown: { honeypot: 15, lpLock: 18, holders: 10, tax: 10, depth: 8, mint: 10, verification: 8, deployer: 6, momentum: 7 },
  },
  {
    chain: "ETH", address: "0xb2d4e18a3f7c5d8b91dd3c2f9e6a27b3c4d5e6f7", name: "Nocturne", symbol: "NOCTA",
    pairAddress: "0x22b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1", dex: "Uniswap v3",
    liquidityUsd: 261_000, marketCapUsd: 2_900_000, holders: 3120, pairCreatedAt: min(3),
    currentScore: 78, flags: ["LP_LOCKED", "VERIFIED"],
    gateBreakdown: { honeypot: 15, lpLock: 20, holders: 9, tax: 8, depth: 9, mint: 10, verification: 8, deployer: 4, momentum: 8 },
  },
  {
    chain: "BSC", address: "0xc3e5f29b4a8d6e9ca2ee4d3fae7b38c4d5e6f7a8", name: "Mogul", symbol: "MOGUL",
    pairAddress: "0x33c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2", dex: "PancakeSwap v2",
    liquidityUsd: 94_000, marketCapUsd: 640_000, holders: 922, pairCreatedAt: min(62),
    currentScore: 57, flags: ["VERIFIED", "TOP10_31PCT"],
    gateBreakdown: { honeypot: 15, lpLock: 8, holders: 5, tax: 10, depth: 5, mint: 10, verification: 8, deployer: 5, momentum: 4 },
  },
  {
    chain: "BSC", address: "0xd4f6a3ac5b9e7face3ff5e4abf8c49d5e6f7a8b9", name: "Sable", symbol: "SABLE",
    pairAddress: "0x44d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3", dex: "PancakeSwap v3",
    liquidityUsd: 127_000, marketCapUsd: 810_000, holders: 1204, pairCreatedAt: min(8),
    currentScore: 64, flags: ["VERIFIED", "TOP10_28PCT"],
    gateBreakdown: { honeypot: 15, lpLock: 12, holders: 6, tax: 8, depth: 6, mint: 10, verification: 8, deployer: 6, momentum: 3 },
  },
  {
    chain: "ETH", address: "0xe5a7b4bd6caf8abdf4aa6f5bcf9d5ae6f7a8b9c0", name: "Fume", symbol: "FUME",
    pairAddress: "0x55e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4", dex: "Uniswap v2",
    liquidityUsd: 310_000, marketCapUsd: 4_100_000, holders: 5230, pairCreatedAt: min(1),
    currentScore: 71, flags: ["VERIFIED"],
    gateBreakdown: { honeypot: 15, lpLock: 10, holders: 9, tax: 10, depth: 9, mint: 10, verification: 8, deployer: 0, momentum: 0 },
  },
  {
    chain: "ETH", address: "0xf6b8c5ce7dbafbcea5bb7a6cdfae6bf7a8b9c0d1", name: "Kiln", symbol: "KILN",
    pairAddress: "0x66f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5", dex: "Uniswap v2",
    liquidityUsd: 76_000, marketCapUsd: 420_000, holders: 618, pairCreatedAt: min(22),
    currentScore: 44, flags: ["TAX_6PCT"],
    gateBreakdown: { honeypot: 15, lpLock: 8, holders: 6, tax: 4, depth: 4, mint: 0, verification: 8, deployer: 4, momentum: -5 },
  },
  {
    chain: "BSC", address: "0xa7c9d6df8ecbacfb96cc8b7deabf7ca8b9c0d1e2", name: "Drip", symbol: "DRIP",
    pairAddress: "0x77a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6", dex: "PancakeSwap v2",
    liquidityUsd: 21_000, marketCapUsd: 88_000, holders: 240, pairCreatedAt: min(220),
    currentScore: 24, flags: ["HONEYPOT_RISK", "MINT_OPEN"],
    gateBreakdown: { honeypot: 0, lpLock: 0, holders: 3, tax: 2, depth: 2, mint: 0, verification: 8, deployer: 2, momentum: 7 },
  },
  {
    chain: "BSC", address: "0xb8dae7ea9fdcbdac07dd9c8efbca8db9c0d1e2f3", name: "Veld", symbol: "VELD",
    pairAddress: "0x88b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7", dex: "PancakeSwap v3",
    liquidityUsd: 205_000, marketCapUsd: 1_750_000, holders: 2410, pairCreatedAt: min(35),
    currentScore: 76, flags: ["LP_LOCKED", "VERIFIED"],
    gateBreakdown: { honeypot: 15, lpLock: 17, holders: 8, tax: 10, depth: 7, mint: 10, verification: 8, deployer: 5, momentum: -4 },
  },
] as const;

async function main() {
  for (const t of TOKENS) {
    const { gateBreakdown, flags, ...rest } = t;
    const token = await prisma.token.upsert({
      where: { chain_address: { chain: t.chain, address: t.address } },
      update: { ...rest, flags: [...flags], gateBreakdown },
      create: { ...rest, flags: [...flags], gateBreakdown },
    });

    // one representative signal per interesting token
    const existing = await prisma.signal.count({ where: { tokenId: token.id } });
    if (existing === 0) {
      if (t.symbol === "PEPEX") {
        await prisma.signal.create({
          data: {
            tokenId: token.id, type: "ENTRY", score: 82, firedAt: min(9),
            reasoning:
              "Price cleared its 3-hour range on 4.1× average volume while liquidity grew $48K and no single wallet exceeded 3% of supply. LP locked 180 days; verified contract, no mint authority.",
            gates: t.gateBreakdown,
          },
        });
      } else if (t.symbol === "KILN") {
        await prisma.signal.create({
          data: {
            tokenId: token.id, type: "EXIT", score: 38, firedAt: min(41),
            reasoning:
              "Buy pressure flipped negative over 20 minutes, two early wallets moved 11% of supply to exchanges, and liquidity fell 18% from its peak. Score dropped 33 points in an hour.",
            gates: t.gateBreakdown,
          },
        });
      } else if (t.symbol === "DRIP") {
        await prisma.signal.create({
          data: {
            tokenId: token.id, type: "RISK", score: 24, firedAt: min(180),
            reasoning:
              "Sell simulation failed twice after a contract update and mint authority remains open. Treat as untradeable.",
            gates: t.gateBreakdown,
          },
        });
      } else if (t.symbol === "NOCTA") {
        await prisma.signal.create({
          data: {
            tokenId: token.id, type: "ENTRY", score: 78, firedAt: min(2),
            reasoning:
              "Fresh pair passed all nine gates within two blocks; LP locked 365 days, deployer's previous launch exited cleanly. Early momentum building on 210 unique buyers.",
            gates: t.gateBreakdown,
          },
        });
      }
    }
  }
  const tokens = await prisma.token.count();
  const signals = await prisma.signal.count();
  console.log(`seeded: ${tokens} tokens, ${signals} signals`);
}

main().finally(() => prisma.$disconnect());
