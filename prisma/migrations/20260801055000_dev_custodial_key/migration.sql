-- Custodial deployer keys, encrypted at rest (AES-256-GCM), same shape as the
-- bot's wallet storage: ciphertext, iv and auth tag kept separately.
ALTER TABLE "DevProfile" ADD COLUMN IF NOT EXISTS "encKey" TEXT;
ALTER TABLE "DevProfile" ADD COLUMN IF NOT EXISTS "keyIv" TEXT;
ALTER TABLE "DevProfile" ADD COLUMN IF NOT EXISTS "keyTag" TEXT;
