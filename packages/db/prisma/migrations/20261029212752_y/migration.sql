/*
  Warnings:

  - Changed the type of `quantity` on the `Fill` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `price` on the `Fill` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Fill" DROP COLUMN "quantity",
ADD COLUMN     "quantity" BIGINT NOT NULL,
DROP COLUMN "price",
ADD COLUMN     "price" BIGINT NOT NULL;
