

export type TradingFeeRole = "MAKER" | "TAKER";

export interface TradingFeeLedgerEntry {
  entry_id: string;
  trade_id: string;
  order_id: string;
  market_id: string;
  user_id: string;
  role: TradingFeeRole;
  amount: bigint;
  balance_after: bigint;
}

export interface TradingFeeSettlement {
  collateral_asset: string;
  balance: bigint;
  total_maker_fees: bigint;
  total_taker_fees: bigint;
  entries: TradingFeeLedgerEntry[];
}

export type InsuranceFundLedgerEntryType =
  | "LIQUIDATION_FEE"
  | "LIQUIDATION_SURPLUS"
  | "SHORTFALL_COVER"
  | "UNCOVERED_SHORTFALL"
  | "FUNDING_SHORTFALL_COVER";

export interface InsuranceFundLedgerEntry {
  entry_id: string;
  market_id: string;
  user_id: string;
  liquidation_order_id: string | null;
  funding_interval_end_ms?: number | null;
  type: InsuranceFundLedgerEntryType;
  amount: bigint;
  balance_after: bigint;
  uncovered_shortfall: bigint;
}

export interface InsuranceFundSettlement {
  collateral_asset: string;
  balance: bigint;
  total_liquidation_fees: bigint;
  total_liquidation_surplus: bigint;
  total_shortfall_covered: bigint;
  total_uncovered_shortfall: bigint;
  liquidation_fee: bigint;
  liquidation_surplus: bigint;
  user_refund: bigint;
  shortfall_covered: bigint;
  uncovered_shortfall: bigint;
  entries: InsuranceFundLedgerEntry[];
}

export type SettlementInput = {
  entry_id_prefix: string;
  market_id: string;
  user_id: string;
  liquidation_order_id: string;
  execution_equity: bigint;
  requested_liquidation_fee: bigint;
};

export type FeeCharge = {
  trade_id: string;
  order_id: string;
  market_id: string;
  user_id: string;
  role: TradingFeeRole;
  amount: bigint;
};
