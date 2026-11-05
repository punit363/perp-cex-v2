import { MarketRepo } from "db/repositories/market.repo";
import CONFIG from "./config";
import MarketData from "./market_data";
import { createPublisher } from "./publisher";
import RedisHandler from "./redis";
import { createSources } from "./sources";

let markets = await MarketRepo.listMarkets();
if (markets.length === 0) throw new Error("List markets before starting market data");

const marketData = new MarketData(markets.map(({ slug }) => slug));
const sources = createSources(marketData);
sources.start();

const redis = new RedisHandler();
await redis.connect();
const publisher = createPublisher(marketData, redis, () => markets);
let marketRefreshInProgress = false;

const marketSignature = (items: typeof markets): string =>
  items.map(({ market_id, slug }) => `${market_id}:${slug}`).sort().join("|");

const refreshMarkets = async (): Promise<void> => {
  if (marketRefreshInProgress) return;
  marketRefreshInProgress = true;
  try {
    const updated = await MarketRepo.listMarkets();
    if (marketSignature(updated) !== marketSignature(markets)) {
      const subscriptions = marketData.setMarkets(updated.map(({ slug }) => slug));
      markets = updated;
      sources.syncSubscriptions(subscriptions);
    }
  } catch (error) {
    console.error("Failed to refresh market list:", error);
  } finally {
    marketRefreshInProgress = false;
  }
};

setInterval(() => { void refreshMarkets(); }, CONFIG.marketRefreshMs);
setInterval(sources.checkConnections, CONFIG.sampleIntervalMs);
setInterval(() => { void sources.pollCoinbaseBook(); }, CONFIG.coinbasePollIntervalMs);
setInterval(() => { void publisher.publish(); }, CONFIG.sampleIntervalMs);
