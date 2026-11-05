import type Orderbook from '../orderbook';
import type { FundingState } from './funding';

export interface markPriceMetadata {
  producer_id: string;
  source_timestamp: number;
  sequence: bigint;
}

export type CandleDraft = {
  market_id: string;
  start_ms: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  base_volume: bigint;
  quote_volume: bigint;
  trade_count: number;
};

export type MarketRiskConfig = {
  maintenanceMarginRate: bigint;
  liquidationFeeRate: bigint;
  maxLeverage: bigint | null;
  maxLiquidationQuantity: bigint | null;
};

export type MarketDefinition = {
  market_id: string;
  slug: string;
};

/** Live state owned by one market. Account balances and command queues live in Engine. */
export type MarketContext = {
  book: Orderbook;
  quote: string;
  risk: MarketRiskConfig;
  funding: FundingState;
  markPrice?: bigint;
  markPriceMetadata?: markPriceMetadata;
  positionUserIds: Set<string>;
  halted: boolean;
};
