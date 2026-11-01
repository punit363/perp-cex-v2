import { prisma } from "..";

export const CandleRepo = {
  listMarketCandles: (market_id: string) => prisma.candle.findMany({
    where: { market_id },
    orderBy: { start_ms: "asc" },
  }),
};
