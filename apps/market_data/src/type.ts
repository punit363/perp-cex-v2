type SpotVenue = "coinbase" | "kraken";

interface SpotQuote {
  market_id: string;
  venue: SpotVenue;
  source_symbol: string;
  bid: string;
  ask: string;
  source_timestamp: string;
  received_at_ms: number;
  source_sequence: string | null;
}

interface MarkPriceUpdate {
  action: "MARK_PRICE_UPDATE";
  market_id: string;
  mark_price: string;
  source_timestamp: number;
  producer_id: string;
  sequence: string;
}

type Product = { symbol: string; base: string; quote: string; status: string };
type Book = { bids: Set<bigint>; asks: Set<bigint> };
type Prices = { bid: bigint; ask: bigint };

export type { Product, Book, Prices, SpotVenue, SpotQuote, MarkPriceUpdate };
