-- CreateTable
CREATE TABLE "DevTokenAttribution" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevTokenAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevTokenAttribution_wallet_idx" ON "DevTokenAttribution"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "DevTokenAttribution_chain_tokenAddress_key" ON "DevTokenAttribution"("chain", "tokenAddress");
