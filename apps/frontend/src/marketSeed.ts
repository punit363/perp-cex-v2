import { candleRangeStart, type StoredCandle, type TradeRecord } from "./marketData";
import { MARKET_MAX_LEVERAGE } from "../../../packages/commons/src/supported-markets";

// Public Kraken USD spot snapshot, 2026-11-12 16:49 UTC. These are display-only
// references for markets without local trade history; they are never orders.
export const SEED_AT = Date.parse("2026-11-12T16:49:00Z");
export const SEED_LABEL = "12 Nov 2026, 16:49 UTC";

type SpotReference = {
  price: number;
  open: number;
  high: number;
  low: number;
  baseVolume: number;
  trades: number;
};

const references: Record<string, SpotReference> = {
  "ADA-USDT": { price: 0.170496, open: 0.174148, high: 0.180462, low: 0.167389, baseVolume: 32717825, trades: 10161 },
  "AVAX-USDT": { price: 8.349, open: 8.512, high: 8.73, low: 8.226, baseVolume: 408222, trades: 7197 },
  "BCH-USDT": { price: 225.72, open: 228.63, high: 233.96, low: 223.07, baseVolume: 3694, trades: 2074 },
  "BTC-USDT": { price: 71666.4, open: 73928.5, high: 74754.1, low: 71133.4, baseVolume: 3394, trades: 172938 },
  "DOGE-USDT": { price: 0.0656513, open: 0.0674038, high: 0.0695012, low: 0.0644802, baseVolume: 62627856, trades: 8713 },
  "FIL-USDT": { price: 0.74, open: 0.751, high: 0.781, low: 0.729, baseVolume: 376597, trades: 1181 },
  "LINK-USDT": { price: 9.97348, open: 10.1803, high: 10.57724, low: 9.7626, baseVolume: 398746, trades: 8554 },
  "LTC-USDT": { price: 49.26, open: 50.19, high: 51.61, low: 48.36, baseVolume: 60696, trades: 10759 },
  "OP-USDT": { price: 0.0945, open: 0.0969, high: 0.1028, low: 0.0922, baseVolume: 2381232, trades: 889 },
  "SOL-USDT": { price: 81.41, open: 83.18, high: 85.77, low: 80.37, baseVolume: 198103, trades: 28715 },
  "UNI-USDT": { price: 6.0525, open: 6.232, high: 6.6721, low: 5.924, baseVolume: 588573, trades: 11305 },
  "USDC-USDT": { price: 0.9997, open: 0.9998, high: 0.9998, low: 0.9996, baseVolume: 89854432, trades: 13102 },
  "XRP-USDT": { price: 1.02371, open: 1.05104, high: 1.07953, low: 1.01516, baseVolume: 26475419, trades: 30955 },
};

export const seedMarketSlugs = Object.keys(references);
export const seedPrice = (slug: string) => references[slug]?.price ?? null;
export const seedMaxLeverage = (slug: string) =>
  MARKET_MAX_LEVERAGE[slug as keyof typeof MARKET_MAX_LEVERAGE] ?? null;
export const seedMaxLeverageScaled = (slug: string) => {
  const maxLeverage = seedMaxLeverage(slug);
  return maxLeverage === null ? null : String(maxLeverage * 100_000_000);
};
export const SEED_ORDER_LEVERAGE = 8;
// The price anchors above are spot references. The change and path below are
// illustrative demo activity, so the empty exchange does not imply that every
// market fell in its first session. Recorded exchange candles always replace it.
const illustrativeGains: Record<string, number> = {
  "BTC-USDT": 0.004,
  "SOL-USDT": 0.008,
  "XRP-USDT": 0.005,
  "DOGE-USDT": 0.012,
  "ADA-USDT": 0.011,
  "AVAX-USDT": 0.009,
  "LINK-USDT": 0.013,
  "UNI-USDT": 0.013,
};
const illustrativeOpen = (slug: string, item: SpotReference) =>
  illustrativeGains[slug] === undefined ? item.open : item.price / (1 + illustrativeGains[slug]);

export const seedTicker = (slug: string) => {
  const item = references[slug];
  if (!item) return null;
  const open = illustrativeOpen(slug, item);
  return {
    changePercent: (item.price - open) / open * 100,
    high: item.high,
    low: item.low,
    volume: item.baseVolume * item.price,
  };
};

const decimal = (value: number) => value.toFixed(8);
const fraction = (value: number) => value - Math.floor(value);
const hash = (value: number) => fraction(Math.sin(value * 12.9898) * 43758.5453);

const candleCache = new Map<string, StoredCandle[]>();

export const seedCandles = (slug: string): StoredCandle[] => {
  const cached = candleCache.get(slug);
  if (cached) return cached;
  const item = references[slug];
  if (!item) return [];
  const anchor = Math.floor(SEED_AT / 60_000) * 60_000;
  const anchorHour = Math.floor(anchor / 3_600_000) * 3_600_000;
  const anchorDay = Math.floor(anchor / 86_400_000) * 86_400_000;
  const hourlyStart = anchorDay - 7 * 86_400_000;
  const minuteStart = anchorHour - 12 * 3_600_000;
  const seed = seedMarketSlugs.indexOf(slug) + 1;
  const rows: StoredCandle[] = [];
  const open = illustrativeOpen(slug, item);
  const change = (item.price - open) / open;
  const weekOpen = item.price / (1 + change * 1.7);
  let previous = weekOpen * (1 + 0.03 * Math.sin(seed));
  const firstDaily = Math.floor(candleRangeStart("3M", SEED_AT)! / 86_400_000) * 86_400_000;
  for (let start_ms = firstDaily; start_ms < hourlyStart; start_ms += 86_400_000) {
    const wave = (hash(seed * 719 + start_ms / 86_400_000) - 0.5) * weekOpen * 0.025;
    const close = Math.max(0.00000001, previous + (weekOpen - previous) * 0.04 + wave);
    rows.push({
      start_ms,
      open: decimal(previous), high: decimal(Math.max(previous, close)), low: decimal(Math.min(previous, close)), close: decimal(close),
      base_volume: decimal(item.baseVolume), quote_volume: decimal(item.baseVolume * item.price), trade_count: item.trades,
    });
    previous = close;
  }
  const firstHour = Math.round((anchorHour - hourlyStart) / 3_600_000);
  for (let hour = firstHour; hour > 12; hour--) {
    if (hour === 24) previous = open;
    const progress = (firstHour - hour) / (firstHour - 12);
    const inLastDay = hour <= 24;
    const baseline = inLastDay
      ? open + (item.price - open) * (24 - hour) / 24
      : previous + (open - previous) * (progress / 3);
    const wave = (hash(seed * 997 + hour) - 0.5) * (inLastDay ? Math.min(item.high - item.low, Math.abs(item.price - open) * 0.3) : Math.abs(item.price - open) * 0.3);
    const close = Math.max(0.00000001, inLastDay ? Math.min(item.high, Math.max(item.low, baseline + wave)) : baseline + wave);
    rows.push({
      start_ms: anchorHour - hour * 3_600_000,
      open: decimal(previous), high: decimal(hour === 16 ? item.high : Math.max(previous, close)), low: decimal(Math.min(previous, close)), close: decimal(close),
      base_volume: decimal(item.baseVolume / 24), quote_volume: decimal(item.baseVolume * item.price / 24), trade_count: Math.round(item.trades / 24),
    });
    previous = close;
  }
  // Keep the final 12 hours at minute resolution without overlapping hourly rows.
  const lowMinuteStart = anchorHour - 8 * 3_600_000;
  const minuteOpen = previous;
  for (let start_ms = minuteStart; start_ms < anchor; start_ms += 60_000) {
    const progress = (start_ms - minuteStart) / (anchor - minuteStart);
    const baseline = minuteOpen + (item.price - minuteOpen) * progress;
    const noise = (hash(seed * 313 + start_ms / 60_000) - 0.5) * (item.high - item.low) * 0.08 * (1 - progress);
    const close = Math.max(0.00000001, Math.min(item.high, Math.max(item.low, baseline + noise)));
    rows.push({
      start_ms,
      open: decimal(previous), high: decimal(Math.max(previous, close)), low: decimal(start_ms === lowMinuteStart ? Math.min(item.low, previous, close) : Math.min(previous, close)), close: decimal(close),
      base_volume: decimal(item.baseVolume / 1440), quote_volume: decimal(item.baseVolume * item.price / 1440), trade_count: Math.round(item.trades / 1440),
    });
    previous = close;
  }
  rows.push({
    start_ms: anchor,
    open: decimal(previous), high: decimal(Math.max(previous, item.price)), low: decimal(Math.min(previous, item.price)), close: decimal(item.price),
    base_volume: "0", quote_volume: "0", trade_count: 0,
  });
  const sorted = rows.sort((a, b) => a.start_ms - b.start_ms);
  candleCache.set(slug, sorted);
  return sorted;
};

export const seedStats = (slug: string, days: number) => {
  const item = references[slug];
  if (!item) return { change: null, volume: null, trades: null, points: [] as number[] };
  const rows = seedCandles(slug).filter((row) => row.start_ms >= SEED_AT - days * 86_400_000);
  const points = Array.from({ length: Math.min(48, rows.length) }, (_, index) => Number(rows[Math.round(index * (rows.length - 1) / (Math.min(48, rows.length) - 1))]!.close));
  const first = days === 1 ? illustrativeOpen(slug, item) : points[0];
  return {
    change: first ? (item.price - first) / first * 100 : null,
    volume: item.baseVolume * item.price * days,
    trades: item.trades * days,
    points,
  };
};

export const seedDepth = (slug: string) => {
  const item = references[slug];
  if (!item) return null;
  const step = Math.max(item.price * 0.00025, 0.00000001);
  const size = Math.max(item.baseVolume / 20_000, 0.0001);
  return {
    asks: Array.from({ length: 12 }, (_, index) => ({ price: decimal(item.price + step * (index + 1)), quantity: decimal(size * (0.3 + hash(index + 7) * 1.7)) })),
    bids: Array.from({ length: 12 }, (_, index) => ({ price: decimal(item.price - step * (index + 1)), quantity: decimal(size * (0.3 + hash(index + 23) * 1.7)) })),
  };
};

export const seedTrades = (slug: string): TradeRecord[] => {
  const item = references[slug];
  if (!item) return [];
  return Array.from({ length: 12 }, (_, index) => ({
    trade_id: `reference-${slug}-${index}`,
    price: decimal(item.price * (1 + (hash(index + 19) - 0.5) * 0.003)),
    quantity: decimal(Math.max(item.baseVolume / 100_000 * (0.2 + hash(index + 37)), 0.0001)),
    taker_side: index % 2 ? "BUY" : "SELL",
    time: SEED_AT - index * 75_000,
  }));
};
