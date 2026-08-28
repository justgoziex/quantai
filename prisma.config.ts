import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Migrations need a direct connection. On Neon, DATABASE_URL is the
    // pooled (PgBouncer) URL for the serverless runtime and
    // DIRECT_DATABASE_URL bypasses the pooler for `prisma migrate deploy`.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
