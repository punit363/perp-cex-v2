enum OrderStatus {
  OPEN = "OPEN",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
}

enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

enum OrderType {
  MARKET = "MARKET",
  LIMIT = "LIMIT",
}

enum PositionType {
  LONG = "LONG",
  SHORT = "SHORT",
}

interface OrderDBUpdate {
  user_id: string;
  order_id: string;
  market_id: string;
  type: OrderType;
  side: OrderSide;
  price: bigint;
  slippage: bigint;
  quantity: bigint;
  filled: bigint;
  initial_margin: bigint;
  leverage: bigint;
  remaining_order_margin: bigint;
  status: OrderStatus;
  arrival_seq: bigint;
}
interface FillDBUpdate {
  trade_id: string;
  maker_order_id: string;
  taker_order_id: string;
  maker_user_id: string;
  taker_user_id: string;
  price: bigint;
  quantity: bigint;
}
interface PositionDBUpdate {
  user_id: string;
  market_id: string;
  type: PositionType;
  quantity: bigint;
  reserved_margin: bigint;
  avg_entry_price: bigint;
  unrealized_pnl: bigint;
  funding_accrued: bigint;
}

export { OrderStatus, OrderType, OrderSide, PositionType };
export type { OrderDBUpdate, FillDBUpdate, PositionDBUpdate };
