-- CreateTable
CREATE TABLE "ChannelCall" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER,
    "callPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "callMcapUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "peakMultiple" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "hitMultiples" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelCall_createdAt_idx" ON "ChannelCall"("createdAt");

-- CreateIndex
CREATE INDEX "ChannelCall_lastCheckAt_idx" ON "ChannelCall"("lastCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelCall_chain_tokenAddress_key" ON "ChannelCall"("chain", "tokenAddress");
