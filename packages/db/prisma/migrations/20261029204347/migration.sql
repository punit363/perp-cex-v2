/*
  Warnings:

  - A unique constraint covering the columns `[user_id]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Order_user_id_key" ON "Order"("user_id");
