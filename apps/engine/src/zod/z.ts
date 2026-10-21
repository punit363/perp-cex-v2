import { OrderSide, OrderType } from "commons/src/order.type";
import { parseFixed } from "../math/fixed-point";
import z from "zod";

const OrderSideSchema = z.enum(OrderSide);
const OrderTypeSchema = z.enum(OrderType);

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
    equity: decimalToFixed,
    type: OrderTypeSchema,
    side: OrderSideSchema,
  }),
  z.object({
    action: z.literal("CANCEL_ORDER"),
    order_id: z.string().min(1),
    user_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("GET_FUNDING_RATE"),
    market_id: z.string().min(1),
    funding_rate: decimalToFixed,
  }),
  z.object({
    action: z.literal("SPOT_PRICE_UPDATE"),
    market_id: z.string().min(1),
    mark_price: decimalToFixed,
  }),
  z.object({
    action: z.literal("GET_DEPTH"),
    market_id: z.string().min(1),
  }),
]);

type EngineCommand = z.output<typeof RequestToEngineSchema>;

export { RequestToEngineSchema };
export type { EngineCommand };
