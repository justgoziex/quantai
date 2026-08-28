-- The highest market cap a token has reached. Creator cashback is priced from
-- what a token achieved, not what it happens to be worth today.
ALTER TABLE "Token" ADD COLUMN IF NOT EXISTS "peakMarketCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Seed it from the current value so existing tokens start with a sane floor
-- rather than zero, which would read as "never achieved anything".
UPDATE "Token" SET "peakMarketCapUsd" = "marketCapUsd" WHERE "peakMarketCapUsd" = 0;
