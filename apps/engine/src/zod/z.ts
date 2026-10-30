import {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType,
} from "commons/src/order.type";
import { parseFixed, SCALE } from "../math/fixed-point";
import z from "zod";

const OrderSideSchema = z.enum(OrderSide);
const OrderTypeSchema = z.enum(OrderType);
const OrderStatusSchema = z.enum(OrderStatus);
const SnapshotInteger = z.string().regex(/^-?\d+$/);
const isPositiveSnapshotInteger = (value: string) =>
  /^\d+$/.test(value) && BigInt(value) > 0n;
const SnapshotOrderSchema = z.object({
  order_id: z.string().min(1),
  user_id: z.string().min(1),
  quantity: SnapshotInteger,
  price: SnapshotInteger,
  filled: SnapshotInteger,
  leverage: SnapshotInteger,
  side: OrderSideSchema,
}).refine(
  (order) =>
    isPositiveSnapshotInteger(order.quantity) &&
    isPositiveSnapshotInteger(order.price) &&
    isPositiveSnapshotInteger(order.leverage) &&
    /^\d+$/.test(order.filled) &&
    BigInt(order.filled) < BigInt(order.quantity),
  { message: "Snapshot order has invalid quantity, price, filled, or leverage" }
);

const EngineSnapshotSchema = z.object({
  version: z.literal(2),
  snapshot_time: z.number().int().nonnegative(),
  scale: z.literal(Number(SCALE)),
  last_applied_stream_id: z.string().regex(/^\d+-\d+$/),
  markets: z.array(z.object({
    market_id: z.string().min(1),
    last_traded_price: SnapshotInteger,
    last_trade_id: z.string(),
    orders: z.array(SnapshotOrderSchema),
  })),
  accounts: z.array(z.object({
    user_id: z.string().min(1),
    collateral: z.object({
      available: SnapshotInteger,
      reserved: SnapshotInteger,
    }),
    positions: z.array(z.object({
      market_id: z.string().min(1),
      type: z.enum(PositionType),
      quantity: SnapshotInteger,
      reserved_margin: SnapshotInteger,
      avg_entry_price: SnapshotInteger,
      unrealized_pnl: SnapshotInteger,
      funding_accrued: SnapshotInteger,
    })),
  })),
  mark_prices: z.array(z.object({
    market_id: z.string().min(1),
    price: SnapshotInteger.refine(isPositiveSnapshotInteger),
    producer_id: z.string().min(1),
    source_timestamp: z.number().int().nonnegative(),
    sequence: z.string().regex(/^\d+$/),
  })),
}).superRefine((snapshot, context) => {
  const accountIds = new Set<string>();
  snapshot.accounts.forEach((account, index) => {
    if (accountIds.has(account.user_id)) {
      context.addIssue({
        code: "custom",
        path: ["accounts", index, "user_id"],
        message: "Duplicate snapshot account",
      });
    }
    accountIds.add(account.user_id);
    const positionMarkets = new Set<string>();
    account.positions.forEach((position, positionIndex) => {
      if (positionMarkets.has(position.market_id)) {
        context.addIssue({
          code: "custom",
          path: ["accounts", index, "positions", positionIndex, "market_id"],
          message: "Duplicate snapshot position",
        });
      }
      positionMarkets.add(position.market_id);
    });
  });

  const marketIds = new Set<string>();
  const orderIds = new Set<string>();
  snapshot.markets.forEach((market, marketIndex) => {
    if (marketIds.has(market.market_id)) {
      context.addIssue({
        code: "custom",
        path: ["markets", marketIndex, "market_id"],
        message: "Duplicate snapshot market",
      });
    }
    marketIds.add(market.market_id);
    market.orders.forEach((order, orderIndex) => {
      const path = ["markets", marketIndex, "orders", orderIndex];
      if (orderIds.has(order.order_id)) {
        context.addIssue({ code: "custom", path, message: "Duplicate snapshot order" });
      }
      if (!accountIds.has(order.user_id)) {
        context.addIssue({ code: "custom", path, message: "Snapshot order has no account" });
      }
      orderIds.add(order.order_id);
    });
  });

  const markIds = new Set<string>();
  snapshot.mark_prices.forEach((mark, index) => {
    if (markIds.has(mark.market_id)) {
      context.addIssue({
        code: "custom",
        path: ["mark_prices", index, "market_id"],
        message: "Duplicate snapshot mark price",
      });
    }
    markIds.add(mark.market_id);
  });
});

const decimalToFixed = z.string().transform((value, context) => {
  try {
    return parseFixed(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid decimal value",
    });
    return z.NEVER;
  }
});

const RequestToEngineSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ONRAMP"),
    user_id: z.string().min(1),
    amount: decimalToFixed,
  }),
  z.object({
    action: z.literal("PLACE_ORDER"),
    user_id: z.string().min(1),
    market_id: z.string().min(1),
    order_id: z.string().min(1),
    price: decimalToFixed,
    quantity: decimalToFixed,
    leverage: decimalToFixed,
    filled: decimalToFixed,
    type: OrderTypeSchema,
    status: OrderStatusSchema,
    side: OrderSideSchema,
  }),
  z.object({
    action: z.literal("CANCEL_ORDER"),
    order_id: z.string().min(1),
    user_id: z.string().min(1),
    market_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("GET_FUNDING_RATE"),
    market_id: z.string().min(1),
    funding_rate: decimalToFixed,
  }),
  z.object({
    action: z.literal("MARK_PRICE_UPDATE"),
    market_id: z.string().min(1),
    mark_price: decimalToFixed,
    source_timestamp: z.number().int().nonnegative(),
    producer_id: z.string().min(1),
    sequence: z.string().regex(/^\d+$/),
  }),
  z.object({
    action: z.literal("GET_DEPTH"),
    market_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("GET_BALANCE"),
    user_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("GET_POSITION"),
    market_id: z.string().min(1),
    user_id: z.string().min(1),
  }),
]);

type EngineCommand = z.output<typeof RequestToEngineSchema>;

export { EngineSnapshotSchema, RequestToEngineSchema };
export type { EngineCommand };
