-- AlterTable
ALTER TABLE "ChannelCall" ADD COLUMN     "callLiqUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredReason" TEXT;

-- CreateIndex
CREATE INDEX "ChannelCall_retiredAt_lastCheckAt_idx" ON "ChannelCall"("retiredAt", "lastCheckAt");
