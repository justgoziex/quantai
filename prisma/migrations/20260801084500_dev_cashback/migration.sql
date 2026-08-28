-- Creator cashback: one claim per token per developer, amount frozen at claim
-- time, settled manually by the desk in the chain's own asset.
CREATE TABLE IF NOT EXISTS "DevCashbackClaim" (
  "id"           TEXT NOT NULL,
  "devId"        TEXT NOT NULL,
  "chain"        "Chain" NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "symbol"       TEXT,
  "tokenScore"   INTEGER NOT NULL DEFAULT 0,
  "liquidityUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "volume24hUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amountNative" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "asset"        TEXT NOT NULL DEFAULT 'ETH',
  "payoutWallet" TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "adminNote"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt"   TIMESTAMP(3),
  "paidAt"       TIMESTAMP(3),
  "payoutTxHash" TEXT,
  CONSTRAINT "DevCashbackClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DevCashbackClaim_devId_chain_tokenAddress_key"
  ON "DevCashbackClaim"("devId", "chain", "tokenAddress");
CREATE INDEX IF NOT EXISTS "DevCashbackClaim_status_createdAt_idx"
  ON "DevCashbackClaim"("status", "createdAt");

ALTER TABLE "DevCashbackClaim" ADD CONSTRAINT "DevCashbackClaim_devId_fkey"
  FOREIGN KEY ("devId") REFERENCES "DevProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
