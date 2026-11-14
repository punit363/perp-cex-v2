import { prisma } from "./index";
import { MARKET_MAX_LEVERAGE, SUPPORTED_MARKET_SLUGS } from "commons/src/supported-markets";

async function seedMarkets() {
  const markets = SUPPORTED_MARKET_SLUGS.map((slug) => ({
    slug,
    imageUrl: `/icons/${slug.split("-")[0]!.toLowerCase()}_coin.png`,
    max_leverage: BigInt(MARKET_MAX_LEVERAGE[slug]) * 100_000_000n,
  }));

  const existing = await prisma.market.findMany({
    where: { slug: { in: markets.map(({ slug }) => slug) } },
    select: { market_id: true, slug: true, imageUrl: true, max_leverage: true },
  });
  const existingBySlug = new Map(existing.map((market) => [market.slug, market]));
  let created = 0;
  let updated = 0;

  for (const market of markets) {
    const record = existingBySlug.get(market.slug);
    if (!record) {
      await prisma.market.create({ data: market });
      created++;
    } else if (record.imageUrl !== market.imageUrl || record.max_leverage === null) {
      await prisma.market.update({
        where: { market_id: record.market_id },
        data: {
          ...(record.imageUrl !== market.imageUrl && { imageUrl: market.imageUrl }),
          ...(record.max_leverage === null && { max_leverage: market.max_leverage }),
        },
      });
      updated++;
    }
  }

  console.log(`Markets: ${markets.length} pairs, ${created} created, ${updated} updated.`);
}

try {
  await seedMarkets();
} finally {
  await prisma.$disconnect();
}
