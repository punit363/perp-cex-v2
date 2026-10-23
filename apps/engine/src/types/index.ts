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
  entry_price: bigint;
  realized_pnl: bigint;
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
  quanity: bigint;
  filled: bigint;
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

interface EngineResponse {
  message: string;
  status: number;
  data: any;
}

interface Order {
  user_id: string;
  order_id: string;
  quantity: bigint;
  price: bigint;
  filled: bigint;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  market_id: string;
}

export type {
  EngineResponse,
  UserAccount,
  Position,
  CollateralBalance,
  PriceLevel,
  OrderNode,
  Order,
};
