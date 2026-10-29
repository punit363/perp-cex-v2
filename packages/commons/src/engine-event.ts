import { z } from "zod";
import { OrderSide, OrderStatus, OrderType, PositionType } from "./order.type";

// Stream values stay as JSON strings until a consumer converts them for storage.
const DecimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);
const IdSchema = z.string().min(1);

const BalanceChangeSchema = z.object({
  user_id: IdSchema,
  available: DecimalSchema,
  reserved: DecimalSchema,
});

const OrderChangeSchema = z.object({
  order_id: IdSchema,
  user_id: IdSchema,
  market_id: IdSchema,
  type: z.enum(OrderType),
  side: z.enum(OrderSide),
  status: z.enum(OrderStatus),
  price: DecimalSchema,
  quantity: DecimalSchema,
  filled: DecimalSchema,
  leverage: DecimalSchema,
  initial_margin: DecimalSchema,
  remaining_order_margin: DecimalSchema,
});

const FillChangeSchema = z.object({
  trade_id: IdSchema,
  market_id: IdSchema,
  maker_order_id: IdSchema,
  taker_order_id: IdSchema,
  maker_user_id: IdSchema,
  taker_user_id: IdSchema,
  price: DecimalSchema,
  quantity: DecimalSchema,
});

const PositionSchema = z.object({
  type: z.enum(PositionType),
  quantity: DecimalSchema,
  reserved_margin: DecimalSchema,
  avg_entry_price: DecimalSchema,
  unrealized_pnl: DecimalSchema,
  funding_accrued: DecimalSchema,
});

const PositionChangeSchema = z.object({
  user_id: IdSchema,
  market_id: IdSchema,
  position: PositionSchema.nullable(),
});

const DepthLevelSchema = z.object({
  price: DecimalSchema,
  quantity: DecimalSchema,
});

const MarketDataChangeSchema = z.object({
  market_id: IdSchema,
  mark_price: DecimalSchema.optional(),
  last_traded_price: DecimalSchema.optional(),
  last_trade_id: IdSchema.optional(),
});

const EventMetadataSchema = z.object({
  schema_version: z.literal(1),
  source_message_id: IdSchema,
  occurred_at_ms: z.number().int().nonnegative(),
});

export const DBEventSchema = EventMetadataSchema.extend({
  destination: z.literal("db"),
  event_type: z.enum([
    "ONRAMP",
    "PLACE_ORDER",
    "CANCEL_ORDER",
    "MARK_PRICE_UPDATE",
    "FUNDING_SETTLEMENT",
  ]),
  changes: z.object({
    balances: z.array(BalanceChangeSchema).default([]),
    orders: z.array(OrderChangeSchema).default([]),
    fills: z.array(FillChangeSchema).default([]),
    positions: z.array(PositionChangeSchema).default([]),
    market_data: z.array(MarketDataChangeSchema).default([]),
  }),
});

const WebSocketMetadataSchema = EventMetadataSchema.extend({
  destination: z.literal("ws"),
});

const BookEventSchema = WebSocketMetadataSchema.extend({
  event_type: z.literal("BOOK"),
  data: z.object({
    market_id: IdSchema,
    bids: z.array(DepthLevelSchema),
    asks: z.array(DepthLevelSchema),
  }),
});

const TradeEventSchema = WebSocketMetadataSchema.extend({
  event_type: z.literal("TRADE"),
  data: z.object({
    trade_id: IdSchema,
    market_id: IdSchema,
    price: DecimalSchema,
    quantity: DecimalSchema,
    taker_side: z.enum(OrderSide),
  }),
});

const TickerEventSchema = WebSocketMetadataSchema.extend({
  event_type: z.literal("TICKER"),
  data: z.object({
    market_id: IdSchema,
    mark_price: DecimalSchema.optional(),
    last_traded_price: DecimalSchema.optional(),
    last_trade_id: IdSchema.optional(),
    best_bid: DecimalSchema.optional(),
    best_ask: DecimalSchema.optional(),
  }),
});

export const WebSocketEventSchema = z.discriminatedUnion("event_type", [
  BookEventSchema,
  TradeEventSchema,
  TickerEventSchema,
]);

export const EngineEventSchema = z.union([
  DBEventSchema,
  WebSocketEventSchema,
]);

export type DBEvent = z.output<typeof DBEventSchema>;
export type WebSocketEvent = z.output<typeof WebSocketEventSchema>;
export type EngineEvent = z.output<typeof EngineEventSchema>;
