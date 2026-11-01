CREATE TYPE "PositionState" AS ENUM ('HEALTHY', 'LIQUIDATING', 'BANKRUPT');
CREATE TYPE "LiquidationStatus" AS ENUM ('LIQUIDATING', 'COMPLETED', 'BANKRUPT');

ALTER TABLE "Market" ADD COLUMN "trading_halted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Market"
  ADD COLUMN "maintenance_margin_rate" BIGINT,
  ADD COLUMN "liquidation_fee_rate" BIGINT,
  ADD COLUMN "max_leverage" BIGINT,
  ADD COLUMN "max_liquidation_quantity" BIGINT;
ALTER TABLE "Position"
  ADD COLUMN "state" "PositionState" NOT NULL DEFAULT 'HEALTHY',
  ADD COLUMN "liquidation_id" TEXT,
  ADD COLUMN "liquidation_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Liquidation" (
  "liquidation_id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "market_id" TEXT NOT NULL,
  "status" "LiquidationStatus" NOT NULL,
  "initial_quantity" BIGINT NOT NULL,
  "remaining_quantity" BIGINT NOT NULL,
  "total_filled" BIGINT NOT NULL,
  "total_realized_pnl" BIGINT NOT NULL,
  "total_liquidation_fee" BIGINT NOT NULL,
  "total_user_refund" BIGINT NOT NULL,
  "total_shortfall_covered" BIGINT NOT NULL,
  "total_uncovered_shortfall" BIGINT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "LiquidationAttempt" (
  "attempt_id" TEXT NOT NULL PRIMARY KEY,
  "liquidation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "market_id" TEXT NOT NULL,
  "status" "LiquidationStatus" NOT NULL,
  "attempt" INTEGER NOT NULL,
  "initial_quantity" BIGINT NOT NULL,
  "filled_quantity" BIGINT NOT NULL,
  "remaining_quantity" BIGINT NOT NULL,
  "mark_price" BIGINT NOT NULL,
  "realized_pnl" BIGINT NOT NULL,
  "liquidation_fee" BIGINT NOT NULL,
  "user_refund" BIGINT NOT NULL,
  "shortfall_covered" BIGINT NOT NULL,
  "uncovered_shortfall" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidationAttempt_liquidation_id_fkey"
    FOREIGN KEY ("liquidation_id") REFERENCES "Liquidation"("liquidation_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Liquidation_user_id_market_id_created_at_idx"
  ON "Liquidation"("user_id", "market_id", "created_at");
CREATE INDEX "LiquidationAttempt_user_id_market_id_created_at_idx"
  ON "LiquidationAttempt"("user_id", "market_id", "created_at");

CREATE TABLE "ProcessedEngineEvent" (
  "source_message_id" TEXT NOT NULL PRIMARY KEY,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
