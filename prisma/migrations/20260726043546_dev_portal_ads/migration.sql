-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "devListed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DevProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevListing" (
    "id" TEXT NOT NULL,
    "devId" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "feeEth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeTxHash" TEXT,
    "tokenId" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listedAt" TIMESTAMP(3),

    CONSTRAINT "DevListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "devId" TEXT,
    "chain" "Chain" NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "headline" TEXT,
    "ctaUrl" TEXT,
    "days" INTEGER NOT NULL DEFAULT 1,
    "feeEth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeTxHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevProfile_wallet_idx" ON "DevProfile"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "DevProfile_userId_wallet_key" ON "DevProfile"("userId", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "DevListing_feeTxHash_key" ON "DevListing"("feeTxHash");

-- CreateIndex
CREATE INDEX "DevListing_status_createdAt_idx" ON "DevListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DevListing_devId_idx" ON "DevListing"("devId");

-- CreateIndex
CREATE UNIQUE INDEX "DevListing_chain_tokenAddress_key" ON "DevListing"("chain", "tokenAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_feeTxHash_key" ON "AdCampaign"("feeTxHash");

-- CreateIndex
CREATE INDEX "AdCampaign_status_endsAt_idx" ON "AdCampaign"("status", "endsAt");

-- CreateIndex
CREATE INDEX "AdCampaign_devId_idx" ON "AdCampaign"("devId");

-- AddForeignKey
ALTER TABLE "DevProfile" ADD CONSTRAINT "DevProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevListing" ADD CONSTRAINT "DevListing_devId_fkey" FOREIGN KEY ("devId") REFERENCES "DevProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_devId_fkey" FOREIGN KEY ("devId") REFERENCES "DevProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
