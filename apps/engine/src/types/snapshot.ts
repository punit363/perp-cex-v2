import type { OrderSide, PositionType } from 'commons/src/order.type';
import type { PositionState } from './account';

export interface SnapshotOrder {
  order_id: string;
  user_id: string;
  quantity: string;
  price: string;
  filled: string;
  leverage: string;
  side: OrderSide;
}

export interface SnapshotMarket {
  market_id: string;
  last_traded_price: string;
  last_trade_id: string;
  orders: SnapshotOrder[];
  risk_config?: {
    maintenance_margin_rate: string;
    liquidation_fee_rate: string;
    max_leverage: string | null;
    max_liquidation_quantity: string | null;
  };
  funding?: {
    last_settled_interval_ms: number;
    fixed_rate: string | null;
    premium_sum: string;
    premium_samples: number;
    premium_interval_ms: number;
    last_rate: string;
  };
}

export interface SnapshotPosition {
  market_id: string;
  type: PositionType;
  quantity: string;
  reserved_margin: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  funding_accrued: string;
  state?: PositionState;
  liquidation_id?: string;
  liquidation_attempts?: number;
}

export interface SnapshotAccount {
  user_id: string;
  collateral: {
    available: string;
    reserved: string;
  };
  positions: SnapshotPosition[];
}

export interface SnapshotMarkPrice {
  market_id: string;
  price: string;
  producer_id: string;
  source_timestamp: number;
  sequence: string;
}

export interface SnapshotInsuranceFund {
  collateral_asset: string;
  balance: string;
  total_liquidation_fees: string;
  total_liquidation_surplus: string;
  total_shortfall_covered: string;
  total_uncovered_shortfall: string;
}

export interface SnapshotTradingFeeAccount {
  collateral_asset: string;
  balance: string;
  total_maker_fees: string;
  total_taker_fees: string;
}

export interface EngineSnapshot {
  version: 2 | 3 | 4 | 5 | 6 | 7;
  snapshot_time: number;
  scale: number;
  last_applied_stream_id: string;
  markets: SnapshotMarket[];
  accounts: SnapshotAccount[];
  mark_prices: SnapshotMarkPrice[];
  insurance_fund?: SnapshotInsuranceFund;
  trading_fee_account?: SnapshotTradingFeeAccount;
  halted_markets?: string[];
}
