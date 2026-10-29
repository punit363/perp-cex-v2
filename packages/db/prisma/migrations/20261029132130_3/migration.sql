/*
  Warnings:

  - A unique constraint covering the columns `[user_id]` on the table `Collateral` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Collateral_user_id_key" ON "Collateral"("user_id");
