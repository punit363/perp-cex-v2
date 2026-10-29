-- CreateEnum
CREATE TYPE "PositionType" AS ENUM ('LONG', 'SHORT');

-- CreateTable
CREATE TABLE "Position" (
    "user_id" TEXT NOT NULL,
    "market_id" TEXT NOT NULL,
    "type" "PositionType" NOT NULL,
    "quantity" BIGINT NOT NULL,
    "reserved_margin" BIGINT NOT NULL,
    "avg_entry_price" BIGINT NOT NULL,
    "unrealized_pnl" BIGINT NOT NULL,
    "funding_accrued" BIGINT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("user_id","market_id")
);

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
