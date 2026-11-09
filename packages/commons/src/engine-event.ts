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
  reserved: ScaledIntegerSchema
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
  initial_fee: ScaledIntegerSchema,
  remaining_order_margin: ScaledIntegerSchema,
  remaining_order_fee: ScaledIntegerSchema,
  slippage: ScaledIntegerSchema
});

const OrderUpdateSchema = z.object({
  order_id: IdSchema,
  user_id: IdSchema,
  market_id: IdSchema,
  status: z.literal(OrderStatus.CANCELLED),
  remaining_order_margin: ScaledIntegerSchema,
  remaining_order_fee: ScaledIntegerSchema
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
  maker_order_fee_consumed: ScaledIntegerSchema,
  maker_order_fee_remaining: ScaledIntegerSchema,
  taker_fee: ScaledIntegerSchema,
  maker_order_status: z.enum(OrderStatus)
});

const PositionSchema = z.object({
  type: z.enum(PositionType),
  quantity: ScaledIntegerSchema,
  reserved_margin: ScaledIntegerSchema,
  avg_entry_price: ScaledIntegerSchema,
  unrealized_pnl: ScaledIntegerSchema,
  funding_accrued: ScaledIntegerSchema,
  state: z.enum(["HEALTHY", "LIQUIDATING", "BANKRUPT"]).default("HEALTHY"),
  liquidation_id: IdSchema.optional(),
  liquidation_attempts: z.number().int().nonnegative().default(0)
});

const PositionChangeSchema = z.object({
  user_id: IdSchema,
  market_id: IdSchema,
  position: PositionSchema.nullable()
});

const DepthLevelSchema = z.object({
  price: DecimalSchema,
  quantity: DecimalSchema
});

const MarketDataChangeSchema = z.object({
  market_id: IdSchema,
  mark_price: ScaledIntegerSchema.optional(),
  last_traded_price: ScaledIntegerSchema.optional(),
  last_trade_id: IdSchema.optional(),
  trading_halted: z.boolean().optional(),
  maintenance_margin_rate: ScaledIntegerSchema.optional(),
  liquidation_fee_rate: ScaledIntegerSchema.optional(),
  max_leverage: ScaledIntegerSchema.nullable().optional(),
  max_liquidation_quantity: ScaledIntegerSchema.nullable().optional(),
  funding_fixed_rate: ScaledIntegerSchema.nullable().optional(),
  funding_last_rate: ScaledIntegerSchema.optional(),
  last_funding_ms: z.number().int().nonnegative().optional(),
  next_funding_ms: z.number().int().positive().optional()
});

const LiquidationAttemptChangeSchema = z.object({
  attempt_id: IdSchema,
  liquidation_id: IdSchema,
  user_id: IdSchema,
  market_id: IdSchema,
  status: z.enum(["LIQUIDATING", "COMPLETED", "BANKRUPT"]),
  attempt: z.number().int().positive(),
  initial_quantity: ScaledIntegerSchema,
  filled_quantity: ScaledIntegerSchema,
  remaining_quantity: ScaledIntegerSchema,
  mark_price: ScaledIntegerSchema,
  realized_pnl: ScaledIntegerSchema,
  liquidation_fee: ScaledIntegerSchema,
  user_refund: ScaledIntegerSchema,
  shortfall_covered: ScaledIntegerSchema,
  uncovered_shortfall: ScaledIntegerSchema
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
  trade_count: z.number().int().positive()
});

const InsuranceFundLedgerEntrySchema = z.object({
  entry_id: IdSchema,
  market_id: IdSchema,
  user_id: IdSchema,
  liquidation_order_id: IdSchema.nullable(),
  funding_interval_end_ms: z.number().int().positive().nullable().optional(),
  type: z.enum([
    "LIQUIDATION_FEE",
    "LIQUIDATION_SURPLUS",
    "MAKER_FEE_SHARE",
    "TAKER_FEE_SHARE",
    "SHORTFALL_COVER",
    "UNCOVERED_SHORTFALL",
    "FUNDING_SHORTFALL_COVER"
  ]),
  amount: ScaledIntegerSchema,
  balance_after: ScaledIntegerSchema,
  uncovered_shortfall: ScaledIntegerSchema
});

const InsuranceFundChangeSchema = z.object({
  collateral_asset: IdSchema,
  balance: ScaledIntegerSchema,
  total_liquidation_fees: ScaledIntegerSchema,
  total_trading_fees: ScaledIntegerSchema.default("0"),
  total_liquidation_surplus: ScaledIntegerSchema,
  total_shortfall_covered: ScaledIntegerSchema,
  total_uncovered_shortfall: ScaledIntegerSchema,
  entries: z.array(InsuranceFundLedgerEntrySchema)
});

const TradingFeeLedgerEntrySchema = z.object({
  entry_id: IdSchema,
  trade_id: IdSchema,
  order_id: IdSchema,
  market_id: IdSchema,
  user_id: IdSchema,
  role: z.enum(["MAKER", "TAKER"]),
  amount: ScaledIntegerSchema,
  balance_after: ScaledIntegerSchema
});

const TradingFeeAccountChangeSchema = z.object({
  collateral_asset: IdSchema,
  balance: ScaledIntegerSchema,
  total_maker_fees: ScaledIntegerSchema,
  total_taker_fees: ScaledIntegerSchema,
  entries: z.array(TradingFeeLedgerEntrySchema)
});

const FundingIntervalChangeSchema = z.object({
  market_id: IdSchema,
  interval_end_ms: z.number().int().positive(),
  index_price: ScaledIntegerSchema,
  rate: ScaledIntegerSchema,
  sample_count: z.number().int().nonnegative(),
  status: z.enum(["SETTLED", "PARTIAL", "SKIPPED"]),
  total_paid: ScaledIntegerSchema,
  insurance_used: ScaledIntegerSchema,
  uncovered_shortfall: ScaledIntegerSchema,
});

const FundingPaymentChangeSchema = z.object({
  market_id: IdSchema,
  interval_end_ms: z.number().int().positive(),
  user_id: IdSchema,
  amount: ScaledIntegerSchema,
  requested_amount: ScaledIntegerSchema,
  available_debit: ScaledIntegerSchema,
  margin_debit: ScaledIntegerSchema,
  insurance_covered: ScaledIntegerSchema,
  uncovered_shortfall: ScaledIntegerSchema,
});

const EventMetadataSchema = z.object({
  source_message_id: IdSchema,
  occurred_at_ms: z.number().int().nonnegative()
});

export const DBEventSchema = EventMetadataSchema.extend({
  destination: z.literal("db"),
  event_type: z.enum([
    "BALANCE_CHANGE",
    "PLACE_ORDER",
    "CANCEL_ORDER",
    "LIQUIDATION",
    "MARKET_RISK_UPDATE",
    "MARK_PRICE_UPDATE",
    "FUNDING_CONFIG_UPDATE",
    "FUNDING_SETTLEMENT"
  ]),
  changes: z.object({
    balances: z.array(BalanceChangeSchema).default([]),
    orders: z.array(OrderChangeSchema).default([]),
    order_updates: z.array(OrderUpdateSchema).default([]),
    fills: z.array(FillChangeSchema).default([]),
    positions: z.array(PositionChangeSchema).default([]),
    market_data: z.array(MarketDataChangeSchema).default([]),
    candles: z.array(CandleChangeSchema).default([]),
    insurance_fund: z.array(InsuranceFundChangeSchema).default([]),
    trading_fee_account: z.array(TradingFeeAccountChangeSchema).default([]),
    liquidation_attempts: z.array(LiquidationAttemptChangeSchema).default([]),
    funding_intervals: z.array(FundingIntervalChangeSchema).default([]),
    funding_payments: z.array(FundingPaymentChangeSchema).default([])
  })
});

const WSMetadataSchema = EventMetadataSchema.extend({
  destination: z.literal("ws")
});

const BookEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("BOOK"),
  data: z.object({
    market_id: IdSchema,
    bids: z.array(DepthLevelSchema),
    asks: z.array(DepthLevelSchema)
  })
});

const TradeEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("TRADE"),
  data: z.object({
    trade_id: IdSchema,
    market_id: IdSchema,
    price: DecimalSchema,
    quantity: DecimalSchema,
    taker_side: z.enum(OrderSide)
  })
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
    trading_halted: z.boolean().optional()
  })
});

const FundingEventSchema = WSMetadataSchema.extend({
  event_type: z.literal("FUNDING"),
  data: z.object({
    market_id: IdSchema,
    rate: DecimalSchema,
    ready: z.boolean(),
    next_funding_ms: z.number().int().positive(),
    last_settled_ms: z.number().int().nonnegative(),
    sample_count: z.number().int().nonnegative(),
  })
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
    trade_count: z.number().int().positive()
  })
});

export const WSEventSchema = z.discriminatedUnion("event_type", [
  BookEventSchema,
  TradeEventSchema,
  TickerEventSchema,
  CandleEventSchema,
  FundingEventSchema
]);

const PrivateBalanceSchema = z.object({
  available: DecimalSchema,
  reserved: DecimalSchema
});

const PrivateOrderSchema = z.object({
  order_id: IdSchema,
  market_id: IdSchema,
  type: z.enum(OrderType),
  side: z.enum(OrderSide),
  status: z.enum(OrderStatus),
  price: DecimalSchema,
  quantity: DecimalSchema,
  filled: DecimalSchema,
  leverage: DecimalSchema,
  initial_fee: DecimalSchema,
  remaining_order_fee: DecimalSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

const PrivatePositionSchema = z.object({
  market_id: IdSchema,
  type: z.enum(PositionType),
  quantity: DecimalSchema,
  reserved_margin: DecimalSchema,
  avg_entry_price: DecimalSchema,
  unrealized_pnl: DecimalSchema,
  funding_accrued: DecimalSchema,
  state: z.enum(["HEALTHY", "LIQUIDATING", "BANKRUPT"]).default("HEALTHY"),
  liquidation_id: IdSchema.optional()
});

export const PrivateAccountEventSchema = EventMetadataSchema.extend({
  event_type: z.literal("ACCOUNT"),
  user_id: IdSchema,
  data: z.object({
    reason: z.enum([
      "BALANCE_CHANGE",
      "PLACE_ORDER",
      "CANCEL_ORDER",
      "LIQUIDATION",
      "FUNDING_SETTLEMENT"
    ]),
    balance: PrivateBalanceSchema.optional(),
    orders: z.array(PrivateOrderSchema).default([]),
    positions: z.array(PrivatePositionSchema).default([]),
    closed_position_markets: z.array(IdSchema).default([])
  })
});

export const EngineEventSchema = z.union([DBEventSchema, WSEventSchema]);

export type DBEvent = z.output<typeof DBEventSchema>;
export type DBEventInput = z.input<typeof DBEventSchema>;
export type WSEvent = z.output<typeof WSEventSchema>;
export type EngineEvent = z.output<typeof EngineEventSchema>;
export type EngineEventInput = z.input<typeof EngineEventSchema>;
export type PrivateAccountEvent = z.output<typeof PrivateAccountEventSchema>;
export type PrivateAccountEventInput = z.input<
  typeof PrivateAccountEventSchema
>;
