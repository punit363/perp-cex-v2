import CONFIG from "./config";
import type MarketData from "./market_data";
import type RedisHandler from "./redis";
import type { MarkPriceUpdate } from "./type";

type Market = { market_id: string; slug: string };
type FundingInterval = { intervalEnd: number; lastSentAt: number; final: boolean };

export const createPublisher = (
  marketData: MarketData, redis: RedisHandler, getMarkets: () => Market[],
) => {
  const producerId = crypto.randomUUID();
  const startedAt = Date.now();
  const publishedMarkets = new Set<string>();
  const unavailableReported = new Set<string>();
  const sentFundingIntervals = new Map<string, FundingInterval>();
  let sequence = 0;
  let publishInProgress = false;

  const settleFunding = async (market: Market, now: number): Promise<void> => {
    if (!market.slug.endsWith("-USDT")) return;
    const intervalEnd = Math.floor(now / CONFIG.fundingIntervalMs) * CONFIG.fundingIntervalMs;
    const sent = sentFundingIntervals.get(market.market_id);
    if (intervalEnd <= 0 ||
      (sent?.intervalEnd === intervalEnd &&
        (sent.final || now - sent.lastSentAt < CONFIG.fundingRetryMs))) return;
    await redis.sendFundingSettlement(market.market_id, intervalEnd);
    sentFundingIntervals.set(market.market_id, {
      intervalEnd,
      lastSentAt: now,
      final: now - intervalEnd >= CONFIG.fundingFinalityDelayMs,
    });
  };

  const publish = async (): Promise<void> => {
    if (publishInProgress) return;
    publishInProgress = true;
    try {
      const now = Date.now();
      for (const market of getMarkets()) {
        const markPrice = marketData.calculateMarkPrice(
          market.slug, now, CONFIG.maxConnectionAgeMs, CONFIG.coinbaseMaxQuoteAgeMs,
        );
        if (!markPrice) {
          if (publishedMarkets.delete(market.slug)) {
            console.warn(market.slug + " mark unavailable; engine will reject new orders when its previous mark expires");
          } else if (now - startedAt > CONFIG.unavailableWarningAfterMs &&
            !unavailableReported.has(market.slug)) {
            unavailableReported.add(market.slug);
            console.warn(market.slug + " mark unavailable: no live two-venue source route");
          }
          continue;
        }
        const update: MarkPriceUpdate = {
          action: "MARK_PRICE_UPDATE",
          market_id: market.market_id,
          mark_price: markPrice,
          source_timestamp: now,
          producer_id: producerId,
          sequence: String(++sequence),
        };
        await redis.sendMarkPriceToEngine(update);
        await settleFunding(market, now);
        if (!publishedMarkets.has(market.slug)) {
          publishedMarkets.add(market.slug);
          unavailableReported.delete(market.slug);
          console.log(market.slug + " mark active from Coinbase and Kraken");
        }
      }
    } catch (error) {
      console.error("Failed to publish mark prices:", error);
    } finally {
      publishInProgress = false;
    }
  };

  return { publish };
};
