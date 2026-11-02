ALTER TABLE "Market"
  ADD COLUMN "funding_fixed_rate" BIGINT,
  ADD COLUMN "funding_last_rate" BIGINT,
  ADD COLUMN "last_funding_ms" BIGINT,
  ADD COLUMN "next_funding_ms" BIGINT;

CREATE TABLE "FundingInterval" (
  "market_id" TEXT NOT NULL,
  "interval_end_ms" BIGINT NOT NULL,
  "index_price" BIGINT NOT NULL,
  "rate" BIGINT NOT NULL,
  "sample_count" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "total_paid" BIGINT NOT NULL,
  "insurance_used" BIGINT NOT NULL,
  "uncovered_shortfall" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundingInterval_pkey" PRIMARY KEY ("market_id", "interval_end_ms")
);

CREATE TABLE "FundingPayment" (
  "market_id" TEXT NOT NULL,
  "interval_end_ms" BIGINT NOT NULL,
  "user_id" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "requested_amount" BIGINT NOT NULL,
  "available_debit" BIGINT NOT NULL,
  "margin_debit" BIGINT NOT NULL,
  "insurance_covered" BIGINT NOT NULL,
  "uncovered_shortfall" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundingPayment_pkey" PRIMARY KEY ("market_id", "interval_end_ms", "user_id")
);

CREATE INDEX "FundingInterval_market_id_interval_end_ms_idx"
  ON "FundingInterval"("market_id", "interval_end_ms" DESC);
CREATE INDEX "FundingPayment_user_id_market_id_interval_end_ms_idx"
  ON "FundingPayment"("user_id", "market_id", "interval_end_ms" DESC);
