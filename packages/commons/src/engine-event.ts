import { z } from "zod";
import { OrderSide, OrderStatus, OrderType, PositionType } from "./order.type";

// DB events carry scaled integers. BigInts become integer strings on the JSON stream.
const ScaledIntegerSchema = z
  .union([z.bigint(), z.string().regex(/^-?(?:0|[1-9]\d*)$/)])
  .transform((value) => value.toString());

// WS events expose human-readable decimal values.
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
});

const OrderUpdateSchema = z.object({
  order_id: IdSchema,
  user_id: IdSchema,
  market_id: IdSchema,
  status: z.literal(OrderStatus.CANCELLED),
  remaining_order_margin: ScaledIntegerSchema,
});

const FillChangeSchema = z.object({
  trade_id: IdSchema,
  maker_order_id: IdSchema,
  taker_order_id: IdSchema,
  maker_user_id: IdSchema,
  taker_user_id: IdSchema,
  price: ScaledIntegerSchema,
  filled: ScaledIntegerSchema,
  maker_leverage: ScaledIntegerSchema,
  maker_order_margin_consumed: ScaledIntegerSchema,
  maker_order_status: z.enum(OrderStatus),
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

const CandleChangeSchema = z.object({
  market_id: IdSchema,
  start_ms: z.number().int().nonnegative(),
  open: ScaledIntegerSchema,
  high: ScaledIntegerSchema,
  low: ScaledIntegerSchema,
  close: ScaledIntegerSchema,
  base_volume: ScaledIntegerSchema,
  quote_volume: ScaledIntegerSchema,
  trade_count: z.number().int().positive(),
});

const EventMetadataSchema = z.object({
  source_message_id: IdSchema,
  occurred_at_ms: z.number().int().nonnegative(),
});

export const DBEventSchema = EventMetadataSchema.extend({
  destination: z.literal("db"),
  event_type: z.enum([
    "BALANCE_CHANGE",
    "PLACE_ORDER",
    "CANCEL_ORDER",
    "LIQUIDATION",
    "MARK_PRICE_UPDATE",
    "FUNDING_SETTLEMENT",
  ]),
  changes: z.object({
    balances: z.array(BalanceChangeSchema).default([]),
    orders: z.array(OrderChangeSchema).default([]),
    order_updates: z.array(OrderUpdateSchema).default([]),
    fills: z.array(FillChangeSchema).default([]),
    positions: z.array(PositionChangeSchema).default([]),
    market_data: z.array(MarketDataChangeSchema).default([]),
    candles: z.array(CandleChangeSchema).default([]),
  }),
});

const WSMetadataSchema = EventMetadataSchema.extend({
  destination: z.literal("ws"),
});

const BookEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("BOOK"),
  data: z.object({
    market_id: IdSchema,
    bids: z.array(DepthLevelSchema),
    asks: z.array(DepthLevelSchema),
  }),
});

const TradeEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("TRADE"),
  data: z.object({
    trade_id: IdSchema,
    market_id: IdSchema,
    price: DecimalSchema,
    quantity: DecimalSchema,
    taker_side: z.enum(OrderSide),
  }),
});

const TickerEventSchema = WSMetadataSchema.extend({
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

const CandleEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("CANDLE"),
  data: z.object({
    market_id: IdSchema,
    start_ms: z.number().int().nonnegative(),
    open: DecimalSchema,
    high: DecimalSchema,
    low: DecimalSchema,
    close: DecimalSchema,
    base_volume: DecimalSchema,
    quote_volume: DecimalSchema,
    trade_count: z.number().int().positive(),
  }),
});

export const WSEventSchema = z.discriminatedUnion("event_type", [
  BookEventSchema,
  TradeEventSchema,
  TickerEventSchema,
  CandleEventSchema,
]);

export const EngineEventSchema = z.union([DBEventSchema, WSEventSchema]);

export type DBEvent = z.output<typeof DBEventSchema>;
export type DBEventInput = z.input<typeof DBEventSchema>;
export type WSEvent = z.output<typeof WSEventSchema>;
export type EngineEvent = z.output<typeof EngineEventSchema>;
export type EngineEventInput = z.input<typeof EngineEventSchema>;
