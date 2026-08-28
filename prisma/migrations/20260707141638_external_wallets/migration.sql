-- CreateTable
CREATE TABLE "ExternalWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" "Chain" NOT NULL DEFAULT 'ETH',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "cashbackPoints" INTEGER NOT NULL DEFAULT 0,
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalWallet_userId_idx" ON "ExternalWallet"("userId");

-- CreateIndex
CREATE INDEX "ExternalWallet_createdAt_idx" ON "ExternalWallet"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWallet_userId_address_key" ON "ExternalWallet"("userId", "address");

-- AddForeignKey
ALTER TABLE "ExternalWallet" ADD CONSTRAINT "ExternalWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
