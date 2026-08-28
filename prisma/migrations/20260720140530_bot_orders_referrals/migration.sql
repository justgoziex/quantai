-- AlterTable
ALTER TABLE "BotUser" ADD COLUMN     "referralEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "referredBy" TEXT,
ADD COLUMN     "signalMinScore" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "signalsOn" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BotOrder" (
    "id" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "kind" TEXT NOT NULL,
    "triggerUsd" DOUBLE PRECISION NOT NULL,
    "sizeNative" DOUBLE PRECISION,
    "pct" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "txHash" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),

    CONSTRAINT "BotOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotOrder_status_idx" ON "BotOrder"("status");

-- CreateIndex
CREATE INDEX "BotOrder_botUserId_status_idx" ON "BotOrder"("botUserId", "status");

-- AddForeignKey
ALTER TABLE "BotOrder" ADD CONSTRAINT "BotOrder_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
