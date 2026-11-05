import type { RoundingMode } from "../types";
import { FIXED_POINT_CONSTANTS } from "../constants";

/** Parse a plain decimal string into 1e-8 units. Inputs with excess precision fail. */
export const parseFixed = (value: string): bigint => {
  const match = FIXED_POINT_CONSTANTS.DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const sign = match[1]!;
  const whole = match[2]!;
  const fraction = match[3] ?? "";
  if (fraction.length > FIXED_POINT_CONSTANTS.SCALE_DIGITS) {
    throw new Error(`Value has more than ${FIXED_POINT_CONSTANTS.SCALE_DIGITS} decimal places: ${value}`);
  }

  const units = BigInt(whole) * FIXED_POINT_CONSTANTS.SCALE + BigInt(fraction.padEnd(FIXED_POINT_CONSTANTS.SCALE_DIGITS, "0") || "0");
  return sign === "-" ? -units : units;
};

/** Format 1e-8 units as a plain decimal string without trailing fractional zeros. */
export const formatFixed = (value: bigint): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / FIXED_POINT_CONSTANTS.SCALE;
  const fraction = (absolute % FIXED_POINT_CONSTANTS.SCALE)
    .toString()
    .padStart(FIXED_POINT_CONSTANTS.SCALE_DIGITS, "0")
    .replace(/0+$/, "");

  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
};

/** Divide integers with an explicit deterministic rounding rule. */
export const divideRounded = (numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint => {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || rounding === "toward-zero") {
    return quotient;
  }

  const resultIsNegative = (numerator < 0n) !== (denominator < 0n);
  if (rounding === "floor") {
    return resultIsNegative ? quotient - 1n : quotient;
  }
  if (rounding === "ceil") {
    return resultIsNegative ? quotient : quotient + 1n;
  }

  const atLeastHalf = 2n * (remainder < 0n ? -remainder : remainder) >=
    (denominator < 0n ? -denominator : denominator);
  if (!atLeastHalf) {
    return quotient;
  }
  return resultIsNegative ? quotient - 1n : quotient + 1n;
};

/** Multiply two 1e-8 values, explicitly choosing how to round the 1e-16 product. */
export const multiplyFixed = (left: bigint, right: bigint, rounding: RoundingMode): bigint => {
  return divideRounded(left * right, FIXED_POINT_CONSTANTS.SCALE, rounding);
};

/** Divide two 1e-8 values, explicitly choosing how to round the result. */
export const divideFixed = (numerator: bigint, denominator: bigint, rounding: RoundingMode): bigint => {
  return divideRounded(numerator * FIXED_POINT_CONSTANTS.SCALE, denominator, rounding);
};
