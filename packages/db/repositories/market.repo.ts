import { prisma } from "..";

export const MarketRepo = {
  newMarket: async (slug: string, image_url: string) => {
    const response = await prisma.market.create({
      data: {
        slug,
        imageUrl: image_url,
      },
    });

    return response;
  },

  updateMarketData: async (change: {
    market_id: string;
    mark_price?: bigint;
    last_traded_price?: bigint;
    last_trade_id?: string;
  }) => {
    const { market_id, ...data } = change;
    if (Object.keys(data).length === 0) return;
    await prisma.market.update({ where: { id: market_id }, data });
  },
};
