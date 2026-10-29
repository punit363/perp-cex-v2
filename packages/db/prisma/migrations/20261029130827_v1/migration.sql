/*
  Warnings:

  - A unique constraint covering the columns `[trade_id]` on the table `Fill` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[arrival_seq]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `trade_id` to the `Fill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `leverage` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `remaining_order_margin` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Fill" ADD COLUMN     "trade_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "arrival_seq" BIGSERIAL NOT NULL,
ADD COLUMN     "leverage" INTEGER NOT NULL,
ADD COLUMN     "remaining_order_margin" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Collateral" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,

    CONSTRAINT "Collateral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fill_trade_id_key" ON "Fill"("trade_id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_arrival_seq_key" ON "Order"("arrival_seq");
