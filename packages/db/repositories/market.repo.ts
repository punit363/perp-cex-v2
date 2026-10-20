import { prisma } from "..";

export const MarketRepo = {
  new_market: async (slug: string, image_url: string) => {
    const response = await prisma.market.create({
      data: {
        slug,
        imageUrl: image_url,
      },
    });

    return response;
  },
};
