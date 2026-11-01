CREATE TYPE "TradingFeeRole" AS ENUM ('MAKER', 'TAKER');

ALTER TABLE "Order"
  ADD COLUMN "initial_fee" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "remaining_order_fee" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Fill"
  ADD COLUMN "maker_fee" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "taker_fee" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Order"
  ALTER COLUMN "initial_fee" DROP DEFAULT,
  ALTER COLUMN "remaining_order_fee" DROP DEFAULT;
ALTER TABLE "Fill"
  ALTER COLUMN "maker_fee" DROP DEFAULT,
  ALTER COLUMN "taker_fee" DROP DEFAULT;

CREATE TABLE "TradingFeeAccount" (
  "collateral_asset" TEXT NOT NULL,
  "balance" BIGINT NOT NULL,
  "total_maker_fees" BIGINT NOT NULL,
  "total_taker_fees" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingFeeAccount_pkey" PRIMARY KEY ("collateral_asset")
);

CREATE TABLE "TradingFeeLedgerEntry" (
  "entry_id" TEXT NOT NULL,
  "collateral_asset" TEXT NOT NULL,
  "trade_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "market_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" "TradingFeeRole" NOT NULL,
  "amount" BIGINT NOT NULL,
  "balance_after" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingFeeLedgerEntry_pkey" PRIMARY KEY ("entry_id")
);

CREATE INDEX "TradingFeeLedgerEntry_collateral_asset_created_at_idx"
  ON "TradingFeeLedgerEntry"("collateral_asset", "created_at");
CREATE INDEX "TradingFeeLedgerEntry_user_id_created_at_idx"
  ON "TradingFeeLedgerEntry"("user_id", "created_at");
CREATE INDEX "TradingFeeLedgerEntry_trade_id_idx"
  ON "TradingFeeLedgerEntry"("trade_id");
