/*
  Warnings:

  - You are about to drop the column `maker_id` on the `Fill` table. All the data in the column will be lost.
  - You are about to drop the column `taker_id` on the `Fill` table. All the data in the column will be lost.
  - Added the required column `maker_user_id` to the `Fill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taker_user_id` to the `Fill` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_maker_id_fkey";

-- DropForeignKey
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_taker_id_fkey";

-- AlterTable
ALTER TABLE "Fill" DROP COLUMN "maker_id",
DROP COLUMN "taker_id",
ADD COLUMN     "maker_user_id" TEXT NOT NULL,
ADD COLUMN     "taker_user_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_taker_user_id_fkey" FOREIGN KEY ("taker_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
