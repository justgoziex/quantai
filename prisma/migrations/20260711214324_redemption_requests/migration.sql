-- CreateTable
CREATE TABLE "RedemptionRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "feeTxHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RedemptionRequest_status_createdAt_idx" ON "RedemptionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RedemptionRequest_userId_idx" ON "RedemptionRequest"("userId");

-- AddForeignKey
ALTER TABLE "RedemptionRequest" ADD CONSTRAINT "RedemptionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
