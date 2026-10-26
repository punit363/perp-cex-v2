export interface SpotQuote {
  market_id: string;
  venue: "coinbase" | "kraken";
  source_symbol: string;
  bid: string;
  ask: string;
  source_timestamp: string;
  received_at_ms: number;
  source_sequence: string | null;
}

export interface MarkPriceUpdate {
  action: "MARK_PRICE_UPDATE";
  market_id: string;
  mark_price: string;
  source_timestamp: number;
  producer_id: string;
  sequence: string;
}
