-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "demo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DemoAccount" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cashUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startingCashUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoAccount_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "DemoAccount" ADD CONSTRAINT "DemoAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
