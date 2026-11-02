import { prisma } from "..";

export const FundingRepo = {
  listIntervals(market_id: string) {
    return prisma.fundingInterval.findMany({
      where: { market_id }, orderBy: { interval_end_ms: "desc" }, take: 50,
    });
  },
  listPayments(user_id: string, market_id: string) {
    return prisma.fundingPayment.findMany({
      where: { user_id, market_id }, orderBy: { interval_end_ms: "desc" }, take: 100,
    });
  },
};
