// Markets with a USDT settlement quote and a usable Coinbase + Kraken spot route.
// The mark-price producer still requires fresh quotes from both venues at runtime.
export const SUPPORTED_MARKET_SLUGS = [
  "ADA-USDT",
  "AVAX-USDT",
  "BCH-USDT",
  "BTC-USDT",
  "DOGE-USDT",
  "ETH-USDT",
  "FIL-USDT",
  "LINK-USDT",
  "LTC-USDT",
  "OP-USDT",
  "UNI-USDT",
  "USDC-USDT",
  "XRP-USDT",
] as const;

const supportedMarkets = new Set<string>(SUPPORTED_MARKET_SLUGS);

export const isSupportedMarketSlug = (slug: string): boolean =>
  supportedMarkets.has(slug);
