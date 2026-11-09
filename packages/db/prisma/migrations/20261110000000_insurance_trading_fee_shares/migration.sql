ALTER TYPE "InsuranceFundEntryType" ADD VALUE 'MAKER_FEE_SHARE';
ALTER TYPE "InsuranceFundEntryType" ADD VALUE 'TAKER_FEE_SHARE';

ALTER TABLE "InsuranceFund"
  ADD COLUMN "total_trading_fees" BIGINT NOT NULL DEFAULT 0;
