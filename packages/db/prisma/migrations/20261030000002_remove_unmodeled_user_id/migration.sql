-- Some databases have foreign keys pointing at an unmodeled User.user_id column.
-- Point them at the modeled primary key before removing the extra column.
ALTER TABLE "Order" DROP CONSTRAINT "Order_user_id_fkey";
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_maker_user_id_fkey";
ALTER TABLE "Fill" DROP CONSTRAINT "Fill_taker_user_id_fkey";

ALTER TABLE "Order" ADD CONSTRAINT "Order_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_maker_user_id_fkey"
  FOREIGN KEY ("maker_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fill" ADD CONSTRAINT "Fill_taker_user_id_fkey"
  FOREIGN KEY ("taker_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN IF EXISTS "user_id";
