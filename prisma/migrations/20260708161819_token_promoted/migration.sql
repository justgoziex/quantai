-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "promoted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotedUntil" TIMESTAMP(3);
