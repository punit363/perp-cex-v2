import { describe, expect, test } from "bun:test";
import {
  divideFixed,
  divideRounded,
  formatFixed,
  multiplyFixed,
  parseFixed,
} from "./fixed-point";
import {
  calculateFee,
  calculateInitialMargin,
  calculateNotional,
  calculateSignedPnl,
} from "./financial-math";
import { OrderSide } from "commons/src/order.type";
import { RequestToEngineSchema } from "../zod/z";

describe("fixed-point values", () => {
  test("parses and formats decimal strings at 8 decimal places", () => {
    expect(parseFixed("12.34000001")).toBe(1_234_000_001n);
    expect(formatFixed(parseFixed("-0.00000001"))).toBe("-0.00000001");
    expect(formatFixed(parseFixed("4.25000000"))).toBe("4.25");
  });

  test("rejects exponent notation and excess decimal precision", () => {
    expect(() => parseFixed("1e-8")).toThrow();
    expect(() => parseFixed("0.000000001")).toThrow();
  });

  test("applies explicit rounding for signed division", () => {
    expect(divideRounded(5n, 2n, "half-away-from-zero")).toBe(3n);
    expect(divideRounded(-5n, 2n, "half-away-from-zero")).toBe(-3n);
    expect(divideRounded(-5n, 2n, "floor")).toBe(-3n);
    expect(divideRounded(-5n, 2n, "ceil")).toBe(-2n);
    expect(divideRounded(-5n, 2n, "toward-zero")).toBe(-2n);
  });

  test("multiplies and divides fixed-point values with chosen rounding", () => {
    expect(formatFixed(multiplyFixed(parseFixed("1.5"), parseFixed("2"), "toward-zero"))).toBe("3");
    expect(formatFixed(divideFixed(parseFixed("1"), parseFixed("3"), "toward-zero"))).toBe("0.33333333");
  });

  test("uses conservative rounding for notional, fees, margin, and PnL", () => {
    const oneAtomicUnit = 1n;
    const half = parseFixed("0.5");

    expect(calculateNotional(oneAtomicUnit, half)).toBe(0n);
    expect(calculateFee(oneAtomicUnit, half)).toBe(1n);
    expect(calculateInitialMargin(oneAtomicUnit, parseFixed("2"))).toBe(1n);
    expect(calculateSignedPnl(-oneAtomicUnit, half)).toBe(-1n);
  });
});

describe("engine request schema", () => {
  test("builds the discriminated union and transforms decimal strings", () => {
    const parsed = RequestToEngineSchema.parse({
      action: "ONRAMP",
      user_id: "user-1",
      amount: "25.125",
    });

    expect(parsed).toEqual({
      action: "ONRAMP",
      user_id: "user-1",
      amount: 2_512_500_000n,
    });
  });

  test("rejects malformed amounts and unknown action values", () => {
    expect(() => RequestToEngineSchema.parse({
      action: "ONRAMP",
      user_id: "user-1",
      amount: "0.000000001",
    })).toThrow();
    expect(() => RequestToEngineSchema.parse({ action: "UNKNOWN" })).toThrow();
  });

  test("accepts string-valued side and order type enums", () => {
    const parsed = RequestToEngineSchema.parse({
      action: "PLACE_ORDER",
      user_id: "user-1",
      market_id: "BTC-PERP",
      order_id: "order-1",
      price: "65000.25",
      quantity: "0.01",
      leverage: "5",
      filled: "0",
      status: "OPEN",
      type: "LIMIT",
      side: "BUY",
    });

    expect(parsed.action).toBe("PLACE_ORDER");
    if (parsed.action === "PLACE_ORDER") {
      expect(parsed.price).toBe(6_500_025_000_000n);
      expect(parsed.quantity).toBe(1_000_000n);
      expect(parsed.side).toBe(OrderSide.BUY);
    }
  });
});
