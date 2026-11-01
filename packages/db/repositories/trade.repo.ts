import { prisma } from "..";

export const TradeRepo = {
  listMarketTrades: (market_id: string) => prisma.fill.findMany({
    where: { maker_order: { market_id } },
    select: { trade_id: true, price: true, quantity: true, created_at: true, taker_order: { select: { side: true } } },
    orderBy: [{ created_at: "asc" }, { trade_id: "asc" }],
  }),
};
