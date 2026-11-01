CREATE TYPE "InsuranceFundEntryType" AS ENUM (
  'LIQUIDATION_FEE',
  'LIQUIDATION_SURPLUS',
  'SHORTFALL_COVER',
  'UNCOVERED_SHORTFALL'
);

CREATE TABLE "InsuranceFund" (
  "collateral_asset" TEXT NOT NULL,
  "balance" BIGINT NOT NULL,
  "total_liquidation_fees" BIGINT NOT NULL,
  "total_liquidation_surplus" BIGINT NOT NULL,
  "total_shortfall_covered" BIGINT NOT NULL,
  "total_uncovered_shortfall" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InsuranceFund_pkey" PRIMARY KEY ("collateral_asset")
);

CREATE TABLE "InsuranceFundLedgerEntry" (
  "entry_id" TEXT NOT NULL,
  "collateral_asset" TEXT NOT NULL,
  "market_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "liquidation_order_id" TEXT NOT NULL,
  "type" "InsuranceFundEntryType" NOT NULL,
  "amount" BIGINT NOT NULL,
  "balance_after" BIGINT NOT NULL,
  "uncovered_shortfall" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceFundLedgerEntry_pkey" PRIMARY KEY ("entry_id")
);

CREATE INDEX "InsuranceFundLedgerEntry_collateral_asset_created_at_idx"
  ON "InsuranceFundLedgerEntry"("collateral_asset", "created_at");

CREATE INDEX "InsuranceFundLedgerEntry_liquidation_order_id_idx"
  ON "InsuranceFundLedgerEntry"("liquidation_order_id");
