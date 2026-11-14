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
  "SOL-USDT",
  "UNI-USDT",
  "USDC-USDT",
  "XRP-USDT",
] as const;

// Demo exchange risk limits. These are seeded into Market and enforced by Engine.
export const MARKET_MAX_LEVERAGE: Record<(typeof SUPPORTED_MARKET_SLUGS)[number], number> = {
  "ADA-USDT": 20,
  "AVAX-USDT": 20,
  "BCH-USDT": 20,
  "BTC-USDT": 50,
  "DOGE-USDT": 20,
  "ETH-USDT": 50,
  "FIL-USDT": 10,
  "LINK-USDT": 20,
  "LTC-USDT": 20,
  "OP-USDT": 10,
  "SOL-USDT": 30,
  "UNI-USDT": 15,
  "USDC-USDT": 10,
  "XRP-USDT": 20,
};

const supportedMarkets = new Set<string>(SUPPORTED_MARKET_SLUGS);

export const isSupportedMarketSlug = (slug: string): boolean =>
  supportedMarkets.has(slug);
