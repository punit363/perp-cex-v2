/*
  Warnings:

  - Changed the type of `price` on the `Order` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `quantity` on the `Order` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `filled_quantity` on the `Order` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Order" DROP COLUMN "price",
ADD COLUMN     "price" BIGINT NOT NULL,
ALTER COLUMN "slippage" SET DATA TYPE BIGINT,
DROP COLUMN "quantity",
ADD COLUMN     "quantity" BIGINT NOT NULL,
DROP COLUMN "filled_quantity",
ADD COLUMN     "filled_quantity" BIGINT NOT NULL;
