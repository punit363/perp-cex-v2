import { prisma } from "..";
import { SUPPORTED_MARKET_SLUGS } from "commons/src/supported-markets";

const marketFields = {
  market_id: true,
  slug: true,
  imageUrl: true,
  mark_price: true,
  last_traded_price: true,
  trading_halted: true,
  maintenance_margin_rate: true,
  liquidation_fee_rate: true,
  max_leverage: true,
  max_liquidation_quantity: true,
  funding_fixed_rate: true,
  funding_last_rate: true,
  last_funding_ms: true,
  next_funding_ms: true,
} as const;

const findMarkets = (listedOnly: boolean) =>
  prisma.market.findMany({
    where: listedOnly ? { slug: { in: [...SUPPORTED_MARKET_SLUGS] } } : undefined,
    select: marketFields,
    orderBy: { slug: "asc" },
  });

export const MarketRepo = {
  ensureMarket: async (slug: string, imageUrl: string) => {
    try {
      return await prisma.market.upsert({ where: { slug }, create: { slug, imageUrl }, update: {} });
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
      return prisma.market.findUniqueOrThrow({ where: { slug } });
    }
  },
  listMarkets: () => findMarkets(true),
  // Recovery must retain delisted market IDs referenced by snapshots and history.
  listAllMarkets: () => findMarkets(false),

  getMarket: async (market_id: string) => {
    return prisma.market.findUnique({
      where: { market_id },
      select: marketFields,
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
    await prisma.market.update({ where: { market_id }, data });
  },
};
