import type { SpotQuote, SpotVenue } from "./type";

const SCALE = 100_000_000n;
const VENUES: SpotVenue[] = ["coinbase", "kraken"];

type Product = { symbol: string; base: string; quote: string; status: string };
type Book = { bids: Set<bigint>; asks: Set<bigint> };
type Prices = { bid: bigint; ask: bigint };

function parseFixed(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal price");
  return BigInt(match[1]!) * SCALE + BigInt((match[2] ?? "").padEnd(8, "0") || "0");
}

function formatFixed(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole.toString();
}

function pairKey(base: string, quote: string): string {
  return base + "-" + quote;
}

function bestPrice(prices: Set<bigint>, side: "bid" | "ask"): bigint | null {
  let best: bigint | null = null;
  for (const price of prices) {
    if (best === null || (side === "bid" ? price > best : price < best)) best = price;
  }
  return best;
}

class MarketData {
  private markets: { slug: string; base: string; quote: string }[] = [];
  private readonly requiredPairs = new Set<string>();
  private readonly products = new Map<SpotVenue, Map<string, Product>>();
  private readonly catalogs = new Map<SpotVenue, Map<string, Product>>();
  private readonly quotes = new Map<SpotVenue, Map<string, SpotQuote>>();
  private readonly coinbaseBooks = new Map<string, Book>();
  private readonly lastMessageAt = new Map<SpotVenue, number>();

  constructor(marketSlugs: string[]) {
    this.setMarkets(marketSlugs);
  }

  setMarkets(marketSlugs: string[]): Record<SpotVenue, string[]> {
    this.requiredPairs.clear();
    this.markets = marketSlugs.map((slug) => {
      const [base, quote, extra] = slug.split("-");
      if (!base || !quote || extra) throw new Error("Invalid market slug: " + slug);
      this.requiredPairs.add(pairKey(base, quote));
      this.requiredPairs.add(pairKey(quote, base));
      for (const anchor of ["USD", "USDT"]) {
        if (base !== anchor) {
          this.requiredPairs.add(pairKey(base, anchor));
          this.requiredPairs.add(pairKey(anchor, base));
        }
        if (quote !== anchor) {
          this.requiredPairs.add(pairKey(quote, anchor));
          this.requiredPairs.add(pairKey(anchor, quote));
        }
      }
      return { slug, base, quote };
    });
    return { coinbase: this.refreshProducts("coinbase"), kraken: this.refreshProducts("kraken") };
  }

  markVenueSeen(venue: SpotVenue, now: number): void {
    this.lastMessageAt.set(venue, now);
  }

  lastSeenAt(venue: SpotVenue): number | undefined {
    return this.lastMessageAt.get(venue);
  }

  clearVenue(venue: SpotVenue): void {
    this.lastMessageAt.delete(venue);
    this.products.delete(venue);
    this.catalogs.delete(venue);
    this.quotes.delete(venue);
    if (venue === "coinbase") this.coinbaseBooks.clear();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private setProducts(venue: SpotVenue, incoming: Product[], replace: boolean): string[] {
    const catalog = replace ? new Map<string, Product>() : new Map(this.catalogs.get(venue));
    for (const product of incoming) {
      if (product.status === "online") catalog.set(product.symbol, product);
      else catalog.delete(product.symbol);
    }
    this.catalogs.set(venue, catalog);
    return this.refreshProducts(venue);
  }

  private refreshProducts(venue: SpotVenue): string[] {
    const previous = this.products.get(venue) ?? new Map<string, Product>();
    const next = new Map<string, Product>();
    for (const product of this.catalogs.get(venue)?.values() ?? []) {
      if (this.requiredPairs.has(pairKey(product.base, product.quote))) {
        next.set(product.symbol, product);
      }
    }
    const quotes = this.quotes.get(venue);
    for (const [symbol, oldProduct] of previous) {
      const current = next.get(symbol);
      if (current && pairKey(current.base, current.quote) === pairKey(oldProduct.base, oldProduct.quote)) continue;
      quotes?.delete(pairKey(oldProduct.base, oldProduct.quote));
      if (venue === "coinbase") this.coinbaseBooks.delete(symbol);
    }
    this.products.set(venue, next);
    return [...next.keys()].sort();
  }

  registerCoinbaseProducts(message: unknown): string[] | null {
    if (!this.isRecord(message) || message.type !== "status" || !Array.isArray(message.products)) return null;
    const products: Product[] = [];
    for (const item of message.products) {
      if (!this.isRecord(item) || typeof item.id !== "string" || typeof item.base_currency !== "string" || typeof item.quote_currency !== "string" || typeof item.status !== "string") continue;
      products.push({ symbol: item.id, base: item.base_currency, quote: item.quote_currency, status: item.status });
    }
    return this.setProducts("coinbase", products, true);
  }

  registerKrakenInstruments(message: unknown): string[] | null {
    if (!this.isRecord(message) || message.channel !== "instrument" || !this.isRecord(message.data) || !Array.isArray(message.data.pairs)) return null;
    const products: Product[] = [];
    for (const item of message.data.pairs) {
      if (!this.isRecord(item) || typeof item.symbol !== "string" || typeof item.base !== "string" || typeof item.quote !== "string" || typeof item.status !== "string") continue;
      products.push({ symbol: item.symbol, base: item.base === "XBT" ? "BTC" : item.base, quote: item.quote, status: item.status });
    }
    return this.setProducts("kraken", products, message.type === "snapshot");
  }

  private productFor(venue: SpotVenue, symbol: string): Product | undefined {
    return this.products.get(venue)?.get(symbol);
  }

  private storeQuote(quote: SpotQuote): void {
    let venueQuotes = this.quotes.get(quote.venue);
    if (!venueQuotes) {
      venueQuotes = new Map();
      this.quotes.set(quote.venue, venueQuotes);
    }
    venueQuotes.set(quote.market_id, quote);
  }

  normalizeCoinbaseBook(message: unknown, receivedAt: number): void {
    if (!this.isRecord(message) || typeof message.product_id !== "string") return;
    const product = this.productFor("coinbase", message.product_id);
    if (!product) return;

    if (message.type === "snapshot") {
      if (!Array.isArray(message.bids) || !Array.isArray(message.asks)) return;
      const book: Book = { bids: new Set(), asks: new Set() };
      for (const [levels, destination] of [[message.bids, book.bids], [message.asks, book.asks]] as const) {
        for (const level of levels) {
          if (!Array.isArray(level) || typeof level[0] !== "string" || typeof level[1] !== "string") continue;
          try {
            if (parseFixed(level[1]) > 0n) destination.add(parseFixed(level[0]));
          } catch { /* Ignore an invalid source level. */ }
        }
      }
      this.coinbaseBooks.set(product.symbol, book);
    } else if (message.type === "l2update") {
      const book = this.coinbaseBooks.get(product.symbol);
      if (!book || !Array.isArray(message.changes)) return;
      for (const change of message.changes) {
        if (!Array.isArray(change) || (change[0] !== "buy" && change[0] !== "sell") || typeof change[1] !== "string" || typeof change[2] !== "string") continue;
        try {
          const levels = change[0] === "buy" ? book.bids : book.asks;
          const price = parseFixed(change[1]);
          if (parseFixed(change[2]) === 0n) levels.delete(price);
          else levels.add(price);
        } catch { /* Ignore an invalid source level. */ }
      }
    } else return;

    const book = this.coinbaseBooks.get(product.symbol)!;
    const bid = bestPrice(book.bids, "bid");
    const ask = bestPrice(book.asks, "ask");
    if (bid === null || ask === null || bid <= 0n || ask <= 0n || bid > ask) return;
    this.storeQuote({
      market_id: pairKey(product.base, product.quote), venue: "coinbase",
      source_symbol: product.symbol, bid: formatFixed(bid), ask: formatFixed(ask),
      source_timestamp: typeof message.time === "string" ? message.time : new Date(receivedAt).toISOString(),
      received_at_ms: receivedAt, source_sequence: null,
    });
  }

  normalizeKrakenTicker(message: unknown, receivedAt: number): void {
    if (!this.isRecord(message) || message.channel !== "ticker" || !Array.isArray(message.data)) return;
    for (const item of message.data) {
      if (!this.isRecord(item) || typeof item.symbol !== "string") continue;
      const product = this.productFor("kraken", item.symbol);
      if (!product || typeof item.bid !== "number" || typeof item.ask !== "number" || !Number.isFinite(item.bid) || !Number.isFinite(item.ask) || item.bid <= 0 || item.ask <= 0 || item.bid > item.ask || typeof item.timestamp !== "string") continue;
      this.storeQuote({
        market_id: pairKey(product.base, product.quote), venue: "kraken",
        source_symbol: product.symbol, bid: item.bid.toFixed(8), ask: item.ask.toFixed(8),
        source_timestamp: item.timestamp, received_at_ms: receivedAt, source_sequence: null,
      });
    }
  }

  private prices(venue: SpotVenue, base: string, quote: string, now: number, maxCoinbaseQuoteAgeMs: number): Prices | null {
    const direct = this.quotes.get(venue)?.get(pairKey(base, quote));
    const spot = direct ?? this.quotes.get(venue)?.get(pairKey(quote, base));
    if (!spot) return null;
    if (venue === "coinbase" && (now - spot.received_at_ms > maxCoinbaseQuoteAgeMs || spot.received_at_ms > now + 1000)) return null;
    try {
      const bid = parseFixed(spot.bid);
      const ask = parseFixed(spot.ask);
      if (bid <= 0n || ask <= 0n || bid > ask) return null;
      return direct ? { bid, ask } : {
        bid: SCALE * SCALE / ask,
        ask: (SCALE * SCALE + bid - 1n) / bid,
      };
    } catch { return null; }
  }

  private marketPrices(venue: SpotVenue, base: string, quote: string, now: number, maxCoinbaseQuoteAgeMs: number): Prices | null {
    const direct = this.prices(venue, base, quote, now, maxCoinbaseQuoteAgeMs);
    if (direct) return direct;
    for (const anchor of ["USD", "USDT"]) {
      if (base === anchor || quote === anchor) continue;
      const basePrices = this.prices(venue, base, anchor, now, maxCoinbaseQuoteAgeMs);
      const quotePrices = this.prices(venue, quote, anchor, now, maxCoinbaseQuoteAgeMs);
      if (!basePrices || !quotePrices) continue;
      return {
        bid: basePrices.bid * SCALE / quotePrices.ask,
        ask: (basePrices.ask * SCALE + quotePrices.bid - 1n) / quotePrices.bid,
      };
    }
    return null;
  }

  calculateMarkPrice(slug: string, now: number, maxConnectionAgeMs: number, maxCoinbaseQuoteAgeMs = 15_000): string | null {
    const market = this.markets.find((entry) => entry.slug === slug);
    if (!market) return null;
    let sum = 0n;
    for (const venue of VENUES) {
      const seenAt = this.lastMessageAt.get(venue);
      if (seenAt === undefined || now - seenAt > maxConnectionAgeMs || seenAt > now + 1000) return null;
      const prices = this.marketPrices(venue, market.base, market.quote, now, maxCoinbaseQuoteAgeMs);
      if (!prices || prices.bid <= 0n || prices.ask <= 0n || prices.bid > prices.ask) return null;
      sum += prices.bid + prices.ask;
    }
    return formatFixed(sum / 4n);
  }
}

export default MarketData;
