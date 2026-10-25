import type { OrderSide, OrderStatus, OrderType } from "./order.type";

type RequestToEngine =
  | {
      action: "ONRAMP";
      user_id: string;
      amount: string;
    }
  | {
      action: "PLACE_ORDER";
      user_id: string;
      market_id: string;
      price: string;
      quantity: string;
      filled: string;
      side: OrderSide;
      type: OrderType;
      status: OrderStatus;
      leverage: string;
      order_id: string;
    }
  | {
      action: "CANCEL_ORDER";
      user_id: string;
      order_id: string;
      market_id: string;
    }
  | {
      action: "GET_FUNDING_RATE";
      market_id: string;
      funding_rate: string;
    }
  | {
      action: "SPOT_PRICE_UPDATE";
      market_id: string;
      mark_price: string;
    }
  | {
      action: "GET_DEPTH";
      market_id: string;
    }
  | {
      action: "GET_BALANCE";
      user_id: string;
    };

interface EngineResponse {
  message: string;
  status: number;
  data: any;
}

export type { RequestToEngine, EngineResponse };
