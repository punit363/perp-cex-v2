import type { DBEvent } from "commons/src/engine-event";
import { prisma } from "..";

type TradingFeeChange = DBEvent["changes"]["trading_fee_account"][number];

const TradingFeeRepo = {
  projectChange: async (change: TradingFeeChange) => {
    await prisma.$transaction(async (tx) => {
      await tx.tradingFeeAccount.upsert({
        where: { collateral_asset: change.collateral_asset },
        update: {
          balance: BigInt(change.balance),
          total_maker_fees: BigInt(change.total_maker_fees),
          total_taker_fees: BigInt(change.total_taker_fees)
        },
        create: {
          collateral_asset: change.collateral_asset,
          balance: BigInt(change.balance),
          total_maker_fees: BigInt(change.total_maker_fees),
          total_taker_fees: BigInt(change.total_taker_fees)
        }
      });

      if (change.entries.length) {
        await tx.tradingFeeLedgerEntry.createMany({
          data: change.entries.map((entry) => ({
            entry_id: entry.entry_id,
            collateral_asset: change.collateral_asset,
            trade_id: entry.trade_id,
            order_id: entry.order_id,
            market_id: entry.market_id,
            user_id: entry.user_id,
            role: entry.role,
            amount: BigInt(entry.amount),
            balance_after: BigInt(entry.balance_after)
          })),
          skipDuplicates: true
        });
      }
    });
  }
};

export default TradingFeeRepo;
