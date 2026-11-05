import CONFIG from "./config";
import { formatFixed, pairKey, parseFixed } from "./price_utils";
import type { Prices, SpotQuote, SpotVenue } from "./type";

type QuoteBook = Map<SpotVenue, Map<string, SpotQuote>>;
type Market = { slug: string; base: string; quote: string };

const pricesFor = (
  quotes: QuoteBook, venue: SpotVenue, base: string, quote: string,
  now: number, maxCoinbaseQuoteAgeMs: number,
): Prices | null => {
  const direct = quotes.get(venue)?.get(pairKey(base, quote));
  const spot = direct ?? quotes.get(venue)?.get(pairKey(quote, base));
  if (!spot) return null;
  if (venue === "coinbase" &&
    (now - spot.received_at_ms > maxCoinbaseQuoteAgeMs ||
      spot.received_at_ms > now + CONFIG.quoteFutureToleranceMs)) return null;
  try {
    const bid = parseFixed(spot.bid);
    const ask = parseFixed(spot.ask);
    if (bid <= 0n || ask <= 0n || bid > ask) return null;
    return direct ? { bid, ask } : {
      bid: CONFIG.scale * CONFIG.scale / ask,
      ask: (CONFIG.scale * CONFIG.scale + bid - 1n) / bid,
    };
  } catch { return null; }
};

const marketPricesFor = (
  quotes: QuoteBook, venue: SpotVenue, base: string, quote: string,
  now: number, maxCoinbaseQuoteAgeMs: number,
): Prices | null => {
  const direct = pricesFor(quotes, venue, base, quote, now, maxCoinbaseQuoteAgeMs);
  if (direct) return direct;
  for (const anchor of CONFIG.anchors) {
    if (base === anchor || quote === anchor) continue;
    const basePrices = pricesFor(quotes, venue, base, anchor, now, maxCoinbaseQuoteAgeMs);
    const quotePrices = pricesFor(quotes, venue, quote, anchor, now, maxCoinbaseQuoteAgeMs);
    if (!basePrices || !quotePrices) continue;
    return {
      bid: basePrices.bid * CONFIG.scale / quotePrices.ask,
      ask: (basePrices.ask * CONFIG.scale + quotePrices.bid - 1n) / quotePrices.bid,
    };
  }
  return null;
};

export const calculateMarkPrice = (
  slug: string, markets: Market[], quotes: QuoteBook,
  lastMessageAt: Map<SpotVenue, number>, now: number,
  maxConnectionAgeMs: number, maxCoinbaseQuoteAgeMs: number,
): string | null => {
  const market = markets.find((entry) => entry.slug === slug);
  if (!market) return null;
  let sum = 0n;
  for (const venue of CONFIG.venues) {
    const seenAt = lastMessageAt.get(venue);
    if (seenAt === undefined || now - seenAt > maxConnectionAgeMs ||
      seenAt > now + CONFIG.quoteFutureToleranceMs) return null;
    const prices = marketPricesFor(quotes, venue, market.base, market.quote, now, maxCoinbaseQuoteAgeMs);
    if (!prices || prices.bid <= 0n || prices.ask <= 0n || prices.bid > prices.ask) return null;
    sum += prices.bid + prices.ask;
  }
  return formatFixed(sum / BigInt(CONFIG.venues.length * 2));
};
