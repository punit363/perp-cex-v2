-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_maker_order_id_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_taker_order_id_fkey";

-- DropIndex
DROP INDEX "Order_user_id_key";

-- Preserve existing order IDs so historical fills continue to reference them.
ALTER TABLE "Order" ADD COLUMN "order_id" TEXT;
UPDATE "Order" SET "order_id" = "id";
ALTER TABLE "Order" ALTER COLUMN "order_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_order_id_key" ON "Order"("order_id");

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_maker_order_id_fkey" FOREIGN KEY ("maker_order_id") REFERENCES "Order"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_taker_order_id_fkey" FOREIGN KEY ("taker_order_id") REFERENCES "Order"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;
