import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/*
  Prisma 7 singleton with the pg driver adapter.
  `dbConfigured` gates API routes so the app still runs without a database.
*/
export const dbConfigured = Boolean(process.env.DATABASE_URL);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? (dbConfigured ? create() : (null as unknown as PrismaClient));

if (process.env.NODE_ENV !== "production" && dbConfigured) {
  globalForPrisma.prisma = prisma;
}
