-- Keep existing generated user and market IDs while naming them after their domain keys.
-- PostgreSQL updates foreign keys that reference User.id when the column is renamed.
ALTER TABLE "User" RENAME COLUMN "id" TO "user_id";
ALTER TABLE "Market" RENAME COLUMN "id" TO "market_id";

-- These IDs are supplied by the engine or identify an existing user. Promote
-- their unique indexes to primary keys before removing the unused UUID columns.
ALTER TABLE "Order" DROP CONSTRAINT "Order_pkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_pkey" PRIMARY KEY USING INDEX "Order_order_id_key";
ALTER TABLE "Order" DROP COLUMN "id";

ALTER TABLE "Fill" DROP CONSTRAINT "Fill_pkey";
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_pkey" PRIMARY KEY USING INDEX "Fill_trade_id_key";
ALTER TABLE "Fill" DROP COLUMN "id";

ALTER TABLE "Collateral" DROP CONSTRAINT "Collateral_pkey";
ALTER TABLE "Collateral" ADD CONSTRAINT "Collateral_pkey" PRIMARY KEY USING INDEX "Collateral_user_id_key";
ALTER TABLE "Collateral" DROP COLUMN "id";
