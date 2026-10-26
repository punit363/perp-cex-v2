import type { SpotQuote } from "./type";

const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

function parseFixed(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid decimal price: ${value}`);
  }

  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > SCALE_DIGITS) {
    throw new Error(`Price has more than ${SCALE_DIGITS} decimal places: ${value}`);
  }

  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0") || "0");
}

function formatFixed(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE)
    .toString()
    .padStart(SCALE_DIGITS, "0")
    .replace(/0+$/, "");

  return fraction ? `${whole}.${fraction}` : whole.toString();
}

class MarketData {
  private latestQuotes = new Map<string, Map<SpotQuote["venue"], SpotQuote>>();
  private marketIdBySymbol = new Map([
    ["BTC-USD", "BTC-USD"],
    ["BTC/USD", "BTC-USD"],
  ]);

  fetchLatestQuotes(market_ticker: string) {
    return this.latestQuotes.get(market_ticker);
  }

  calculateMarkPrice(spot1: SpotQuote, spot2: SpotQuote): string {
    const spot1_bid = parseFixed(spot1.bid);
    const spot1_ask = parseFixed(spot1.ask);
    const spot2_bid = parseFixed(spot2.bid);
    const spot2_ask = parseFixed(spot2.ask);

    if (spot1_bid > spot1_ask || spot2_bid > spot2_ask) {
      throw new Error("Cannot calculate mark price from a crossed quote");
    }

    const mark_price =
      (spot1_bid + spot1_ask + spot2_bid + spot2_ask) / 4n;

    return formatFixed(mark_price);
  }

  storeQuote(quote: SpotQuote) {
    let market_quote = this.latestQuotes.get(quote.market_id);

    if (!market_quote) {
      market_quote = new Map();
      this.latestQuotes.set(quote.market_id, market_quote);
    }

    market_quote.set(quote.venue, quote);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  public normalizeCoinbaseTicker(
    message: unknown,
    received_at_ms: number
  ): void {
    if (!this.isRecord(message) || message.type !== "ticker") return;
    if (typeof message.product_id !== "string") return;

    const market_id = this.marketIdBySymbol.get(message.product_id);
    if (!market_id) return;
    if (
      typeof message.best_bid !== "string" ||
      typeof message.best_ask !== "string" ||
      typeof message.time !== "string"
    ) {
      return;
    }

    this.storeQuote({
      market_id,
      venue: "coinbase",
      source_symbol: message.product_id,
      bid: message.best_bid,
      ask: message.best_ask,
      source_timestamp: message.time,
      received_at_ms,
      source_sequence:
        typeof message.sequence === "number" ? String(message.sequence) : null,
    });

    return;
  }

  public normalizeKrakenTicker(message: unknown, received_at_ms: number): void {
    if (
      !this.isRecord(message) ||
      message.channel !== "ticker" ||
      !Array.isArray(message.data)
    ) {
      return;
    }

    const quotes: SpotQuote[] = [];
    for (const item of message.data) {
      if (!this.isRecord(item) || typeof item.symbol !== "string") continue;
      const market_id = this.marketIdBySymbol.get(item.symbol);
      if (!market_id) continue;
      if (
        typeof item.bid !== "number" ||
        !Number.isFinite(item.bid) ||
        typeof item.ask !== "number" ||
        !Number.isFinite(item.ask) ||
        typeof item.timestamp !== "string"
      ) {
        continue;
      }

      this.storeQuote({
        market_id,
        venue: "kraken",
        source_symbol: item.symbol,
        bid: String(item.bid),
        ask: String(item.ask),
        source_timestamp: item.timestamp,
        received_at_ms,
        source_sequence: null,
      });
    }
    return;
  }
}

export default MarketData;
