import type {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType,
} from "commons/src/order.type";

interface CollateralBalance {
  available: bigint;
  reserved: bigint;
}

interface Position {
  market_id: string;
  type: PositionType;
  quantity: bigint;
  reserved_margin: bigint;
  avg_entry_price: bigint;
  unrealized_pnl: bigint;
  funding_accrued: bigint;
}

interface UserAccount {
  user_id: string;
  collateral: CollateralBalance;
  positions: Map<string, Position>; //market_id
  orders: Set<string>; //Order_id
}

interface OrderNode {
  order_id: string;
  user_id: string;
  quantity: bigint;
  filled: bigint;
  leverage: bigint;
  side: OrderSide;
  level: PriceLevel;
  prev: OrderNode | null;
  next: OrderNode | null;
}

interface PriceLevel {
  price: bigint;
  remaining_qty: bigint;
  head: OrderNode | null;
  tail: OrderNode | null;
}

interface Order {
  user_id: string;
  order_id: string;
  quantity: bigint;
  price: bigint;
  filled: bigint;
  leverage: bigint;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  market_id: string;
}

type RestingOrder = Pick<
  Order,
  "order_id" | "user_id" | "quantity" | "price" | "filled" | "leverage" | "side"
>;

interface SnapshotOrder {
  order_id: string;
  user_id: string;
  quantity: string;
  price: string;
  filled: string;
  leverage: string;
  side: OrderSide;
}

interface SnapshotMarket {
  market_id: string;
  last_traded_price: string;
  last_trade_id: string;
  orders: SnapshotOrder[];
}

interface SnapshotPosition {
  market_id: string;
  type: PositionType;
  quantity: string;
  reserved_margin: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  funding_accrued: string;
}

interface SnapshotAccount {
  user_id: string;
  collateral: {
    available: string;
    reserved: string;
  };
  positions: SnapshotPosition[];
}

interface SnapshotMarkPrice {
  market_id: string;
  price: string;
  producer_id: string;
  source_timestamp: number;
  sequence: string;
}

interface SnapshotInsuranceFund {
  collateral_asset: string;
  balance: string;
  total_liquidation_fees: string;
  total_liquidation_surplus: string;
  total_shortfall_covered: string;
  total_uncovered_shortfall: string;
}

type InsuranceFundLedgerEntryType =
  | "LIQUIDATION_FEE"
  | "LIQUIDATION_SURPLUS"
  | "SHORTFALL_COVER"
  | "UNCOVERED_SHORTFALL";

interface InsuranceFundLedgerEntry {
  entry_id: string;
  market_id: string;
  user_id: string;
  liquidation_order_id: string;
  type: InsuranceFundLedgerEntryType;
  amount: bigint;
  balance_after: bigint;
  uncovered_shortfall: bigint;
}

interface InsuranceFundSettlement {
  collateral_asset: string;
  balance: bigint;
  total_liquidation_fees: bigint;
  total_liquidation_surplus: bigint;
  total_shortfall_covered: bigint;
  total_uncovered_shortfall: bigint;
  liquidation_fee: bigint;
  liquidation_surplus: bigint;
  shortfall_covered: bigint;
  uncovered_shortfall: bigint;
  entries: InsuranceFundLedgerEntry[];
}

interface EngineSnapshot {
  version: 2 | 3;
  snapshot_time: number;
  scale: number;
  last_applied_stream_id: string;
  markets: SnapshotMarket[];
  accounts: SnapshotAccount[];
  mark_prices: SnapshotMarkPrice[];
  insurance_fund?: SnapshotInsuranceFund;
}

interface Fill {
  maker_user_id: string;
  maker_order_id: string;
  taker_user_id: string;
  taker_order_id: string;
  trade_id: string;
  price: bigint;
  maker_leverage: bigint;
  maker_order_margin_consumed: bigint;
  maker_order_status: OrderStatus;
  filled: bigint;
}

interface PlaceOrderResult {
  order: {
    order_id: string;
    filled: bigint;
    status: OrderStatus;
  };
  fills: Fill[];
}

interface markPriceMetadata {
  producer_id: string;
  source_timestamp: number;
  sequence: bigint;
}

export type {
  UserAccount,
  Position,
  CollateralBalance,
  PriceLevel,
  OrderNode,
  Order,
  RestingOrder,
  SnapshotOrder,
  SnapshotMarket,
  SnapshotPosition,
  SnapshotAccount,
  SnapshotMarkPrice,
  SnapshotInsuranceFund,
  InsuranceFundLedgerEntry,
  InsuranceFundSettlement,
  EngineSnapshot,
  Fill,
  PlaceOrderResult,
  markPriceMetadata,
};
