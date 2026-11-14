import type { CandlestickData, UTCTimestamp } from "lightweight-charts";

export type TradeRecord = {
  trade_id: string;
  price: string;
  quantity: string;
  taker_side: "BUY" | "SELL";
  time: number;
};

export type CandleRange = "all" | "1h" | "1d" | "1M" | "3M";
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
const hour = 60 * minute;
const day = 24 * hour;
const candleDurations: Record<Exclude<CandleRange, "all">, number> = {
  "1h": minute,
  "1d": hour,
  "1M": day,
  "3M": day,
};

export function candleRangeStart(range: CandleRange, endMs: number): number | null {
  if (range === "all") return null;
  if (range === "1h") return endMs - hour;
  if (range === "1d") return endMs - day;

  const end = new Date(endMs);
  const targetMonth = end.getUTCMonth() - (range === "1M" ? 1 : 3);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    end.getUTCFullYear(), targetMonth, Math.min(end.getUTCDate(), lastDay),
    end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds(), end.getUTCMilliseconds()
  );
}

export function candlesInRange(source: StoredCandle[], range: CandleRange, endMs: number): StoredCandle[] {
  const startMs = candleRangeStart(range, endMs);
  return startMs === null ? source : source.filter((candle) => candle.start_ms >= startMs && candle.start_ms <= endMs);
}

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

export function candleDuration(candles: StoredCandle[], range: CandleRange): number {
  if (range !== "all") return candleDurations[range];
  if (candles.length < 2) return minute;
  const span = candles.at(-1)!.start_ms - candles[0]!.start_ms;
  return [minute, 3 * minute, 15 * minute, hour, 4 * hour, day, 7 * day]
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
