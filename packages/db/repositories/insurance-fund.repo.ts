import type { DBEvent } from "commons/src/engine-event";
import { prisma } from "..";

type InsuranceFundChange = DBEvent["changes"]["insurance_fund"][number];

const InsuranceFundRepo = {
  projectChange: async (change: InsuranceFundChange) => {
    await prisma.$transaction(async (tx) => {
      await tx.insuranceFund.upsert({
        where: { collateral_asset: change.collateral_asset },
        update: {
          balance: BigInt(change.balance),
          total_liquidation_fees: BigInt(change.total_liquidation_fees),
          total_trading_fees: BigInt(change.total_trading_fees),
          total_liquidation_surplus: BigInt(change.total_liquidation_surplus),
          total_shortfall_covered: BigInt(change.total_shortfall_covered),
          total_uncovered_shortfall: BigInt(change.total_uncovered_shortfall),
        },
        create: {
          collateral_asset: change.collateral_asset,
          balance: BigInt(change.balance),
          total_liquidation_fees: BigInt(change.total_liquidation_fees),
          total_trading_fees: BigInt(change.total_trading_fees),
          total_liquidation_surplus: BigInt(change.total_liquidation_surplus),
          total_shortfall_covered: BigInt(change.total_shortfall_covered),
          total_uncovered_shortfall: BigInt(change.total_uncovered_shortfall),
        },
      });

      if (change.entries.length) {
        await tx.insuranceFundLedgerEntry.createMany({
          data: change.entries.map((entry) => ({
            entry_id: entry.entry_id,
            collateral_asset: change.collateral_asset,
            market_id: entry.market_id,
            user_id: entry.user_id,
            liquidation_order_id: entry.liquidation_order_id,
            type: entry.type,
            amount: BigInt(entry.amount),
            balance_after: BigInt(entry.balance_after),
            uncovered_shortfall: BigInt(entry.uncovered_shortfall),
          })),
          skipDuplicates: true,
        });
      }
    });
  },
};

export default InsuranceFundRepo;
