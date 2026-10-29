import { z } from "zod";
import { OrderSide, OrderStatus, OrderType, PositionType } from "./order.type";

// DB events carry scaled integers. BigInts become integer strings on the JSON stream.
const ScaledIntegerSchema = z
  .union([z.bigint(), z.string().regex(/^-?(?:0|[1-9]\d*)$/)])
  .transform((value) => value.toString());

// WebSocket events expose human-readable decimal values.
const DecimalSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);
const IdSchema = z.string().min(1);

const BalanceChangeSchema = z.object({
  user_id: IdSchema,
  available: ScaledIntegerSchema,
  reserved: ScaledIntegerSchema,
});

const OrderChangeSchema = z.object({
  order_id: IdSchema,
  user_id: IdSchema,
  market_id: IdSchema,
  type: z.enum(OrderType),
  side: z.enum(OrderSide),
  status: z.enum(OrderStatus),
  price: ScaledIntegerSchema,
  quantity: ScaledIntegerSchema,
  filled: ScaledIntegerSchema,
  leverage: ScaledIntegerSchema,
  initial_margin: ScaledIntegerSchema,
  remaining_order_margin: ScaledIntegerSchema,
  slippage: ScaledIntegerSchema,
  arrival_seq: ScaledIntegerSchema,
});

const FillChangeSchema = z.object({
  trade_id: IdSchema,
  maker_order_id: IdSchema,
  taker_order_id: IdSchema,
  maker_user_id: IdSchema,
  taker_user_id: IdSchema,
  price: ScaledIntegerSchema,
  quantity: ScaledIntegerSchema,
});

const PositionSchema = z.object({
  type: z.enum(PositionType),
  quantity: ScaledIntegerSchema,
  reserved_margin: ScaledIntegerSchema,
  avg_entry_price: ScaledIntegerSchema,
  unrealized_pnl: ScaledIntegerSchema,
  funding_accrued: ScaledIntegerSchema,
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
  mark_price: ScaledIntegerSchema.optional(),
  last_traded_price: ScaledIntegerSchema.optional(),
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
    "BALANCE_CHANGE",
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

export const EngineEventSchema = z.union([DBEventSchema, WebSocketEventSchema]);

export type DBEvent = z.output<typeof DBEventSchema>;
export type WebSocketEvent = z.output<typeof WebSocketEventSchema>;
export type EngineEvent = z.output<typeof EngineEventSchema>;
export type EngineEventInput = z.input<typeof EngineEventSchema>;
