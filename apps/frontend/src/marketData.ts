import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

export type TradeRecord = {
  trade_id: string;
  price: string;
  quantity: string;
  taker_side: "BUY" | "SELL";
  time: number;
};

export type CandleInterval = "all" | "1m" | "3m" | "1h" | "1d";
export type StoredCandle = {
  start_ms: number;
  open: string;
  high: string;
  low: string;
  close: string;
  base_volume: string;
  quote_volume: string;
  trade_count: number;
};

const minute = 60_000;
const intervals: Record<Exclude<CandleInterval, "all">, number> = {
  "1m": minute,
  "3m": 3 * minute,
  "1h": 60 * minute,
  "1d": 24 * 60 * minute,
};

export function mergeTrades(existing: TradeRecord[], incoming: TradeRecord[]): TradeRecord[] {
  const byId = new Map(existing.map((trade) => [trade.trade_id, trade]));
  for (const trade of incoming) {
    if (!byId.has(trade.trade_id)) byId.set(trade.trade_id, trade);
  }
  return [...byId.values()].sort((a, b) => a.time - b.time || a.trade_id.localeCompare(b.trade_id));
}

export function mergeCandles(existing: StoredCandle[], incoming: StoredCandle[]): StoredCandle[] {
  const byTime = new Map(existing.map((candle) => [candle.start_ms, candle]));
  for (const candle of incoming) {
    const previous = byTime.get(candle.start_ms);
    if (!previous || candle.trade_count > previous.trade_count) byTime.set(candle.start_ms, candle);
  }
  return [...byTime.values()].sort((a, b) => a.start_ms - b.start_ms);
}

export function candleDuration(candles: StoredCandle[], interval: CandleInterval): number {
  if (interval !== "all") return intervals[interval];
  if (candles.length < 2) return minute;
  const span = candles.at(-1)!.start_ms - candles[0]!.start_ms;
  return [minute, 3 * minute, 15 * minute, 60 * minute, 4 * 60 * minute, 24 * 60 * minute, 7 * 24 * 60 * minute]
    .find((duration) => span / duration <= 200) ?? 30 * 24 * 60 * minute;
}

export function aggregateCandles(source: StoredCandle[], duration: number): CandlestickData<UTCTimestamp>[] {
  const candles: CandlestickData<UTCTimestamp>[] = [];
  for (const candle of source) {
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close, candle.start_ms].every(Number.isFinite) || open <= 0) continue;
    const time = Math.floor(candle.start_ms / duration) * duration / 1000 as UTCTimestamp;
    const last = candles.at(-1);
    if (last?.time === time) {
      last.high = Math.max(last.high, high);
      last.low = Math.min(last.low, low);
      last.close = close;
    } else {
      candles.push({ time, open, high, low, close });
    }
  }
  return candles;
}

export function tickerFromTrades(trades: TradeRecord[], now = Date.now()) {
  const cutoff = now - 24 * 60 * minute;
  const recent = trades.filter((trade) => trade.time >= cutoff && trade.time <= now);
  const last = trades.at(-1);
  if (!last) return null;

  // The last price before the window is the 24-hour reference when one exists.
  const reference = [...trades].reverse().find((trade) => trade.time < cutoff) ?? recent[0];
  const current = Number(last.price);
  const start = reference ? Number(reference.price) : NaN;
  const change = Number.isFinite(start) && start > 0 ? current - start : null;
  const changePercent = change === null ? null : change / start * 100;
  const prices = recent.map((trade) => Number(trade.price)).filter(Number.isFinite);
  const volume = recent.reduce((total, trade) => total + Number(trade.price) * Number(trade.quantity), 0);

  return {
    price: current,
    change,
    changePercent,
    high: prices.length ? Math.max(...prices) : null,
    low: prices.length ? Math.min(...prices) : null,
    volume: Number.isFinite(volume) ? volume : null,
  };
}
