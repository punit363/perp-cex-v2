import CONFIG from "./config";
import { coinbaseProducts, isRecord, krakenProducts } from "./catalog";
import { bestPrice, formatFixed, pairKey, parseFixed } from "./price_utils";
import { calculateMarkPrice } from "./pricing";
import type { Book, Product, SpotQuote, SpotVenue } from "./type";

class MarketData {
  private markets: { slug: string; base: string; quote: string }[] = [];
  //this set stores the possibility of all the types a market can be named
  private readonly requiredPairs = new Set<string>();
  private readonly products = new Map<SpotVenue, Map<string, Product>>();
  private readonly catalogs = new Map<SpotVenue, Map<string, Product>>();
  private readonly quotes = new Map<SpotVenue, Map<string, SpotQuote>>();
  private readonly coinbaseBooks = new Map<string, Book>();
  private readonly lastMessageAt = new Map<SpotVenue, number>();

  constructor(marketSlugs: string[]) {
    this.setMarkets(marketSlugs);
  }

  //creates required markets from slugs fetched from db (base_quote,quote_base,base_anchor,anchor_base,quote_anchor,anchor_quote)
  setMarkets = (marketSlugs: string[]): Record<SpotVenue, string[]> => {
    this.requiredPairs.clear();
    this.markets = marketSlugs.map((slug) => {
      const [base, quote, extra] = slug.split("-");
      if (!base || !quote || extra)
        throw new Error("Invalid market slug: " + slug);
      this.requiredPairs.add(pairKey(base, quote));
      this.requiredPairs.add(pairKey(quote, base));
      for (const anchor of CONFIG.anchors) {
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
    return {
      coinbase: this.refreshProducts("coinbase"),
      kraken: this.refreshProducts("kraken"),
    };
  };

  markVenueSeen = (venue: SpotVenue, now: number): void => {
    this.lastMessageAt.set(venue, now);
  };

  lastSeenAt = (venue: SpotVenue): number | undefined => {
    return this.lastMessageAt.get(venue);
  };

  clearVenue = (venue: SpotVenue): void => {
    this.lastMessageAt.delete(venue);
    this.products.delete(venue);
    this.catalogs.delete(venue);
    this.quotes.delete(venue);
    if (venue === "coinbase") this.coinbaseBooks.clear();
  };

  //replaces the product catalog for any venue(coinbase/kraken) with available live products
  private setProducts = (
    venue: SpotVenue,
    incoming: Product[],
    replace: boolean
  ): string[] => {
    const catalog = replace
      ? new Map<string, Product>()
      : new Map(this.catalogs.get(venue));
    for (const product of incoming) {
      if (product.status === "online") catalog.set(product.symbol, product);
      else catalog.delete(product.symbol);
    }
    this.catalogs.set(venue, catalog);
    return this.refreshProducts(venue);
  };

  //selects catalog products matching the requiredpairs
  private refreshProducts = (venue: SpotVenue): string[] => {
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
      if (
        current &&
        pairKey(current.base, current.quote) ===
          pairKey(oldProduct.base, oldProduct.quote)
      )
        continue;
      quotes?.delete(pairKey(oldProduct.base, oldProduct.quote));
      if (venue === "coinbase") this.coinbaseBooks.delete(symbol);
    }
    this.products.set(venue, next);
    return [...next.keys()].sort();
  };

  //adds products online at coinbase
  registerCoinbaseProducts = (message: unknown): string[] | null => {
    const products = coinbaseProducts(message);
    if (!products) return null;
    return this.setProducts("coinbase", products, true);
  };

  //adds products online at kraken
  registerKrakenInstruments = (message: unknown): string[] | null => {
    const catalog = krakenProducts(message);
    if (!catalog) return null;
    return this.setProducts("kraken", catalog.products, catalog.replace);
  };

  //gets the online product for a symbol and a venue
  private productFor = (
    venue: SpotVenue,
    symbol: string
  ): Product | undefined => {
    return this.products.get(venue)?.get(symbol);
  };

  //Saves the latest bid and ask under its venue and pair.
  private storeQuote = (quote: SpotQuote): void => {
    let venueQuotes = this.quotes.get(quote.venue);
    if (!venueQuotes) {
      venueQuotes = new Map();
      this.quotes.set(quote.venue, venueQuotes);
    }
    venueQuotes.set(quote.market_id, quote);
  };

  //normalizes data recieved from coinbase
  normalizeCoinbaseBook = (message: unknown, receivedAt: number): void => {
    if (!isRecord(message) || typeof message.product_id !== "string") return;
    const product = this.productFor("coinbase", message.product_id);
    if (!product) return;

    if (message.type === "snapshot") {
      if (!Array.isArray(message.bids) || !Array.isArray(message.asks)) return;
      const book: Book = { bids: new Set(), asks: new Set() };
      for (const [levels, destination] of [
        [message.bids, book.bids],
        [message.asks, book.asks],
      ] as const) {
        for (const level of levels) {
          if (
            !Array.isArray(level) ||
            typeof level[0] !== "string" ||
            typeof level[1] !== "string"
          )
            continue;
          try {
            if (parseFixed(level[1]) > 0n)
              destination.add(parseFixed(level[0]));
          } catch {
            /* Ignore an invalid source level. */
          }
        }
      }
      this.coinbaseBooks.set(product.symbol, book);
    } else if (message.type === "l2update") {
      const book = this.coinbaseBooks.get(product.symbol);
      if (!book || !Array.isArray(message.changes)) return;
      for (const change of message.changes) {
        if (
          !Array.isArray(change) ||
          (change[0] !== "buy" && change[0] !== "sell") ||
          typeof change[1] !== "string" ||
          typeof change[2] !== "string"
        )
          continue;
        try {
          const levels = change[0] === "buy" ? book.bids : book.asks;
          const price = parseFixed(change[1]);
          if (parseFixed(change[2]) === 0n) levels.delete(price);
          else levels.add(price);
        } catch {
          /* Ignore an invalid source level. */
        }
      }
    } else return;

    const book = this.coinbaseBooks.get(product.symbol)!;
    const bid = bestPrice(book.bids, "bid");
    const ask = bestPrice(book.asks, "ask");
    if (bid === null || ask === null || bid <= 0n || ask <= 0n || bid > ask)
      return;
    this.storeQuote({
      market_id: pairKey(product.base, product.quote),
      venue: "coinbase",
      source_symbol: product.symbol,
      bid: formatFixed(bid),
      ask: formatFixed(ask),
      source_timestamp:
        typeof message.time === "string"
          ? message.time
          : new Date(receivedAt).toISOString(),
      received_at_ms: receivedAt,
      source_sequence: null,
    });
  };

  //normalizes data recieved from kraken
  normalizeKrakenTicker = (message: unknown, receivedAt: number): void => {
    if (
      !isRecord(message) ||
      message.channel !== "ticker" ||
      !Array.isArray(message.data)
    )
      return;
    for (const item of message.data) {
      if (!isRecord(item) || typeof item.symbol !== "string") continue;
      const product = this.productFor("kraken", item.symbol);
      if (
        !product ||
        typeof item.bid !== "number" ||
        typeof item.ask !== "number" ||
        !Number.isFinite(item.bid) ||
        !Number.isFinite(item.ask) ||
        item.bid <= 0 ||
        item.ask <= 0 ||
        item.bid > item.ask ||
        typeof item.timestamp !== "string"
      )
        continue;
      this.storeQuote({
        market_id: pairKey(product.base, product.quote),
        venue: "kraken",
        source_symbol: product.symbol,
        bid: item.bid.toFixed(8),
        ask: item.ask.toFixed(8),
        source_timestamp: item.timestamp,
        received_at_ms: receivedAt,
        source_sequence: null,
      });
    }
  };

  calculateMarkPrice = (
    slug: string,
    now: number,
    maxConnectionAgeMs: number,
    maxCoinbaseQuoteAgeMs = CONFIG.coinbaseMaxQuoteAgeMs
  ): string | null => {
    return calculateMarkPrice(
      slug,
      this.markets,
      this.quotes,
      this.lastMessageAt,
      now,
      maxConnectionAgeMs,
      maxCoinbaseQuoteAgeMs
    );
  };
}

export default MarketData;
