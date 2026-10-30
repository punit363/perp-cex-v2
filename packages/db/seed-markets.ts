import { readdir } from "node:fs/promises";
import { prisma } from "./index";

const iconDirectory = new URL("../../apps/frontend/public/icons/", import.meta.url);
const ethQuotedAssets = new Set(["AAVE", "DOT", "GRT", "MATIC", "SOL"]);
const quoteAssets = new Set(["USD", "USDT"]);

async function seedMarkets() {
  const icons = (await readdir(iconDirectory)).filter((file) => /^[a-z0-9]+_coin\.png$/.test(file));
  const markets = icons
    .map((file) => ({ symbol: file.replace(/_coin\.png$/, "").toUpperCase(), file }))
    .filter(({ symbol }) => !quoteAssets.has(symbol))
    .map(({ symbol, file }) => ({
      slug: `${symbol}-${ethQuotedAssets.has(symbol) ? "ETH" : "USDT"}`,
      imageUrl: `/icons/${file}`,
    }));

  const existing = await prisma.market.findMany({
    where: { slug: { in: markets.map(({ slug }) => slug) } },
    select: { market_id: true, slug: true, imageUrl: true },
  });
  const existingBySlug = new Map(existing.map((market) => [market.slug, market]));
  let created = 0;
  let updated = 0;

  for (const market of markets) {
    const record = existingBySlug.get(market.slug);
    if (!record) {
      await prisma.market.create({ data: market });
      created++;
    } else if (record.imageUrl !== market.imageUrl) {
      await prisma.market.update({ where: { market_id: record.market_id }, data: { imageUrl: market.imageUrl } });
      updated++;
    }
  }

  console.log(`Markets: ${markets.length} icon-backed pairs, ${created} created, ${updated} icons updated.`);
}

try {
  await seedMarkets();
} finally {
  await prisma.$disconnect();
}
