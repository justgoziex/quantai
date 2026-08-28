-- AlterTable
ALTER TABLE "ExternalWallet" ADD COLUMN     "activity" JSONB;

-- CreateIndex
CREATE INDEX "Token_liquidityUsd_idx" ON "Token"("liquidityUsd");

-- CreateIndex
CREATE INDEX "Token_pairCreatedAt_idx" ON "Token"("pairCreatedAt");

-- CreateIndex
CREATE INDEX "Token_category_pairCreatedAt_idx" ON "Token"("category", "pairCreatedAt");

-- CreateIndex
CREATE INDEX "Trade_userId_demo_idx" ON "Trade"("userId", "demo");
