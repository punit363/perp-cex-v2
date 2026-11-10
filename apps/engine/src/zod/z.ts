import {
  OrderSide,
  OrderStatus,
  OrderType,
  PositionType,
} from "commons/src/order.type";
import { PositionState } from "../types";
import { parseFixed } from "../math/fixed-point";
import { FIXED_POINT_CONSTANTS } from "../config/constants";
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
});

const SnapshotInsuranceFundSchema = z.object({
  collateral_asset: z.string().min(1),
  balance: SnapshotInteger,
  total_liquidation_fees: SnapshotInteger,
  total_trading_fees: SnapshotInteger.optional(),
  total_liquidation_surplus: SnapshotInteger,
  total_shortfall_covered: SnapshotInteger,
  total_uncovered_shortfall: SnapshotInteger,
});

const SnapshotTradingFeeAccountSchema = z.object({
  collateral_asset: z.string().min(1),
  balance: SnapshotInteger,
  total_maker_fees: SnapshotInteger,
  total_taker_fees: SnapshotInteger,
});

const EngineSnapshotSchema = z
  .object({
    snapshot_time: z.number().int().nonnegative(),
    scale: z.literal(Number(FIXED_POINT_CONSTANTS.SCALE)),
    last_applied_stream_id: z.string().regex(/^\d+-\d+$/),
    markets: z.array(
      z.object({
        market_id: z.string().min(1),
        last_traded_price: SnapshotInteger,
        last_trade_id: z.string(),
        orders: z.array(SnapshotOrderSchema),
        funding: z
          .object({
            last_settled_interval_ms: z.number().int().nonnegative(),
            fixed_rate: SnapshotInteger.nullable(),
            premium_sum: SnapshotInteger,
            premium_samples: z.number().int().nonnegative(),
            premium_interval_ms: z.number().int().nonnegative(),
            last_premium_sample_at_ms: z.number().int().nonnegative().optional(),
            last_rate: SnapshotInteger,
          })
          .optional(),
        risk_config: z
          .object({
            maintenance_margin_rate: SnapshotInteger,
            liquidation_fee_rate: SnapshotInteger,
            max_leverage: SnapshotInteger.nullable(),
            max_liquidation_quantity: SnapshotInteger.nullable(),
          })
          .optional(),
      })
    ),
    accounts: z.array(
      z.object({
        user_id: z.string().min(1),
        collateral: z.object({
          available: SnapshotInteger,
          reserved: SnapshotInteger,
        }),
        positions: z.array(
          z.object({
            market_id: z.string().min(1),
            type: z.enum(PositionType),
            quantity: SnapshotInteger,
            reserved_margin: SnapshotInteger,
            avg_entry_price: SnapshotInteger,
            unrealized_pnl: SnapshotInteger,
            funding_accrued: SnapshotInteger,
            state: z.enum(PositionState).optional(),
            liquidation_id: z.string().min(1).optional(),
            liquidation_attempts: z.number().int().nonnegative().optional(),
          })
        ),
      })
    ),
    mark_prices: z.array(
      z.object({
        market_id: z.string().min(1),
        price: SnapshotInteger.refine(isPositiveSnapshotInteger),
        producer_id: z.string().min(1),
        source_timestamp: z.number().int().nonnegative(),
        sequence: z.string().regex(/^\d+$/),
      })
    ),
    insurance_fund: SnapshotInsuranceFundSchema.optional(),
    trading_fee_account: SnapshotTradingFeeAccountSchema.optional(),
    halted_markets: z.array(z.string().min(1)).optional(),
  })
  .superRefine((snapshot, context) => {
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
      if (
        market.risk_config &&
        BigInt(market.risk_config.maintenance_margin_rate) +
          BigInt(market.risk_config.liquidation_fee_rate) >=
          FIXED_POINT_CONSTANTS.SCALE
      ) {
        context.addIssue({
          code: "custom",
          path: ["markets", marketIndex, "risk_config"],
          message: "Market risk rates must sum to less than one",
        });
      }
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
          context.addIssue({
            code: "custom",
            path,
            message: "Duplicate snapshot order",
          });
        }
        if (!accountIds.has(order.user_id)) {
          context.addIssue({
            code: "custom",
            path,
            message: "Snapshot order has no account",
          });
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
    action: z.literal("REGISTER_MARKET"),
    market_id: z.string().min(1),
    slug: z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/),
  }),
  z.object({ action: z.literal("RETRY_LIQUIDATIONS") }),
  z.object({
    action: z.literal("SET_MARKET_RISK"),
    market_id: z.string().min(1),
    maintenance_margin_rate: decimalToFixed,
    liquidation_fee_rate: decimalToFixed,
    max_leverage: decimalToFixed.nullable(),
    max_liquidation_quantity: decimalToFixed.nullable(),
  }),
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
  }),
  z.object({
    action: z.literal("SET_FUNDING_RATE"),
    market_id: z.string().min(1),
    funding_rate: decimalToFixed.nullable(),
  }),
  z.object({
    action: z.literal("SETTLE_FUNDING"),
    market_id: z.string().min(1),
    interval_end_ms: z.number().int().positive(),
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

export { EngineSnapshotSchema, RequestToEngineSchema };
