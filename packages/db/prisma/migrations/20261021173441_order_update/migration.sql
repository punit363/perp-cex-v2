/*
  Warnings:

  - The values [BID,ASK] on the enum `OrderSide` will be removed. If these variants are still used in the database, this will fail.
  - The values [PARTIAL] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderSide_new" AS ENUM ('BUY', 'SELL');
ALTER TABLE "Order" ALTER COLUMN "side" TYPE "OrderSide_new" USING ("side"::text::"OrderSide_new");
ALTER TYPE "OrderSide" RENAME TO "OrderSide_old";
ALTER TYPE "OrderSide_new" RENAME TO "OrderSide";
DROP TYPE "public"."OrderSide_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('FILLED', 'PARTIALLY_FILLED', 'OPEN', 'CANCELLED');
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
COMMIT;
