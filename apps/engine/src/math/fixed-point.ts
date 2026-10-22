/** Fixed-point representation used for monetary, price, quantity, and rate values. */
export const SCALE_DIGITS = 8;
export const SCALE = 10n ** BigInt(SCALE_DIGITS);

export type RoundingMode =
  | "toward-zero"
  | "floor"
  | "ceil"
  | "half-away-from-zero";

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** Parse a plain decimal string into 1e-8 units. Inputs with excess precision fail. */
export function parseFixed(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const sign = match[1]!;
  const whole = match[2]!;
  const fraction = match[3] ?? "";
  if (fraction.length > SCALE_DIGITS) {
    throw new Error(`Value has more than ${SCALE_DIGITS} decimal places: ${value}`);
  }

  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(SCALE_DIGITS, "0") || "0");
  return sign === "-" ? -units : units;
}

/** Format 1e-8 units as a plain decimal string without trailing fractional zeros. */
export function formatFixed(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE)
    .toString()
    .padStart(SCALE_DIGITS, "0")
    .replace(/0+$/, "");

  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/** Divide integers with an explicit deterministic rounding rule. */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode,
): bigint {
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
}

/** Multiply two 1e-8 values, explicitly choosing how to round the 1e-16 product. */
export function multiplyFixed(
  left: bigint,
  right: bigint,
  rounding: RoundingMode,
): bigint {
  return divideRounded(left * right, SCALE, rounding);
}

/** Divide two 1e-8 values, explicitly choosing how to round the result. */
export function divideFixed(
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode,
): bigint {
  return divideRounded(numerator * SCALE, denominator, rounding);
}
