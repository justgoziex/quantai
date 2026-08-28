-- CreateTable
CREATE TABLE "BotUser" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "chain" TEXT NOT NULL DEFAULT 'bsc',
    "slippageBps" INTEGER NOT NULL DEFAULT 500,
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotWallet" (
    "id" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotTrade" (
    "id" TEXT NOT NULL,
    "botUserId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "amountToken" DOUBLE PRECISION NOT NULL,
    "amountNative" DOUBLE PRECISION NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotUser_chatId_key" ON "BotUser"("chatId");

-- CreateIndex
CREATE INDEX "BotUser_userId_idx" ON "BotUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BotWallet_botUserId_key" ON "BotWallet"("botUserId");

-- CreateIndex
CREATE INDEX "BotWallet_address_idx" ON "BotWallet"("address");

-- CreateIndex
CREATE INDEX "BotTrade_botUserId_createdAt_idx" ON "BotTrade"("botUserId", "createdAt");

-- CreateIndex
CREATE INDEX "BotTrade_botUserId_tokenAddress_idx" ON "BotTrade"("botUserId", "tokenAddress");

-- AddForeignKey
ALTER TABLE "BotWallet" ADD CONSTRAINT "BotWallet_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotTrade" ADD CONSTRAINT "BotTrade_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "BotUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
