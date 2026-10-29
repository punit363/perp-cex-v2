/*
  Warnings:

  - You are about to drop the column `filled_quantity` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `order_type` on the `Order` table. All the data in the column will be lost.
  - Added the required column `filled` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "filled_quantity",
DROP COLUMN "order_type",
ADD COLUMN     "filled" BIGINT NOT NULL,
ADD COLUMN     "type" "OrderType" NOT NULL;
