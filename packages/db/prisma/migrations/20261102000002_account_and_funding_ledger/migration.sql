-- Existing duplicate usernames must be resolved before this index can be created.
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TYPE "InsuranceFundEntryType" ADD VALUE 'FUNDING_SHORTFALL_COVER';
ALTER TABLE "InsuranceFundLedgerEntry"
  ALTER COLUMN "liquidation_order_id" DROP NOT NULL,
  ADD COLUMN "funding_interval_end_ms" BIGINT;
