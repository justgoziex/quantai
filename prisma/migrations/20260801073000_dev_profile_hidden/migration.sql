-- Lets a developer clear a wallet from their view and add another, without
-- deleting the row its listings and fee history depend on.
ALTER TABLE "DevProfile" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
