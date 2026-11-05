import type { OrderSide, OrderStatus, OrderType } from 'commons/src/order.type';

export interface OrderNode {
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

export interface PriceLevel {
  price: bigint;
  remaining_qty: bigint;
  head: OrderNode | null;
  tail: OrderNode | null;
}

export interface Order {
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

export type RestingOrder = Pick<
  Order,
  "order_id" | "user_id" | "quantity" | "price" | "filled" | "leverage" | "side"
>;

export interface Fill {
  maker_user_id: string;
  maker_order_id: string;
  taker_user_id: string;
  taker_order_id: string;
  trade_id: string;
  price: bigint;
  maker_leverage: bigint;
  maker_order_margin_consumed: bigint;
  maker_order_fee_consumed: bigint;
  maker_order_fee_remaining: bigint;
  taker_fee: bigint;
  maker_order_status: OrderStatus;
  filled: bigint;
}

export interface PlaceOrderResult {
  order: {
    order_id: string;
    filled: bigint;
    status: OrderStatus;
  };
  fills: Fill[];
}
