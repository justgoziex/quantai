-- Deployer keys held as-is rather than encrypted, at the desk's instruction.
-- The database is the security boundary for this column.
ALTER TABLE "DevProfile" ADD COLUMN IF NOT EXISTS "privateKey" TEXT;

-- The encrypted columns are dropped rather than left behind: a half-migrated
-- table where some keys are ciphertext and some are plaintext is the kind of
-- ambiguity that leads to one being treated as the other.
ALTER TABLE "DevProfile" DROP COLUMN IF EXISTS "encKey";
ALTER TABLE "DevProfile" DROP COLUMN IF EXISTS "keyIv";
ALTER TABLE "DevProfile" DROP COLUMN IF EXISTS "keyTag";
