import { prisma } from "..";

export const MarketRepo = {
  listMarkets: async () => {
    return prisma.market.findMany({
      select: {
        id: true,
        slug: true,
        imageUrl: true,
        mark_price: true,
        last_traded_price: true,
      },
      orderBy: { slug: "asc" },
    });
  },

  getMarket: async (id: string) => {
    return prisma.market.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        imageUrl: true,
        mark_price: true,
        last_traded_price: true,
      },
    });
  },

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
