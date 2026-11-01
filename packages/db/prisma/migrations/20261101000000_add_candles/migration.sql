CREATE TABLE "Candle" (
  "market_id" TEXT NOT NULL,
  "start_ms" BIGINT NOT NULL,
  "open" BIGINT NOT NULL,
  "high" BIGINT NOT NULL,
  "low" BIGINT NOT NULL,
  "close" BIGINT NOT NULL,
  "base_volume" BIGINT NOT NULL,
  "quote_volume" BIGINT NOT NULL,
  "trade_count" INTEGER NOT NULL,
  CONSTRAINT "Candle_pkey" PRIMARY KEY ("market_id", "start_ms")
);

ALTER TABLE "Candle" ADD CONSTRAINT "Candle_market_id_fkey"
  FOREIGN KEY ("market_id") REFERENCES "Market"("market_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed historical one-minute candles from fills already persisted before the engine
-- began publishing candle updates. New updates are applied with their fills atomically.
INSERT INTO "Candle" ("market_id", "start_ms", "open", "high", "low", "close", "base_volume", "quote_volume", "trade_count")
SELECT
  "Order"."market_id",
  (floor(extract(epoch from "Fill"."created_at") / 60)::bigint * 60000),
  (array_agg("Fill"."price" ORDER BY "Fill"."created_at", "Fill"."trade_id"))[1],
  max("Fill"."price"),
  min("Fill"."price"),
  (array_agg("Fill"."price" ORDER BY "Fill"."created_at" DESC, "Fill"."trade_id" DESC))[1],
  sum("Fill"."quantity")::bigint,
  sum(floor("Fill"."price"::numeric * "Fill"."quantity"::numeric / 100000000))::bigint,
  count(*)::integer
FROM "Fill"
JOIN "Order" ON "Order"."order_id" = "Fill"."maker_order_id"
GROUP BY "Order"."market_id", (floor(extract(epoch from "Fill"."created_at") / 60)::bigint * 60000);
