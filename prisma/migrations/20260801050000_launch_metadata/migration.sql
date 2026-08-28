-- Solana launches carry their own identity: Metaplex stores only a URL
-- on-chain, and these columns are what that URL resolves to.
ALTER TABLE "LaunchConfig" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "LaunchConfig" ADD COLUMN IF NOT EXISTS "description" TEXT;
