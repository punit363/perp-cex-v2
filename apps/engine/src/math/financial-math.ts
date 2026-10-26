import { divideFixed, multiplyFixed } from "./fixed-point";

/** Positive prices and quantities produce notional rounded down to one atomic unit. */
export function calculateNotional(price: bigint, quantity: bigint): bigint {
  if (price < 0n || quantity < 0n) {
    throw new Error("Price and quantity must be non-negative");
  }
  return multiplyFixed(price, quantity, "floor");
}

/** Fees round up so fractional atomic fee amounts are never undercharged. */
export function calculateFee(notional: bigint, feeRate: bigint): bigint {
  if (notional < 0n || feeRate < 0n) {
    throw new Error("Notional and fee rate must be non-negative");
  }
  return multiplyFixed(notional, feeRate, "ceil");
}

/** Initial margin rounds up so fractional atomic requirements are never under-reserved. */
export function calculateInitialMargin(notional: bigint, leverage: bigint): bigint {
  if (notional < 0n || leverage <= 0n) {
    throw new Error("Notional must be non-negative and leverage must be positive");
  }
  return divideFixed(notional, leverage, "ceil");
}

/** Maintenance margin rounds up so the risk requirement is never understated. */
export function calculateMaintenanceMargin(
  notional: bigint,
  maintenanceRate: bigint
): bigint {
  if (notional < 0n || maintenanceRate < 0n) {
    throw new Error("Notional and maintenance rate must be non-negative");
  }
  return multiplyFixed(notional, maintenanceRate, "ceil");
}

/** Signed position PnL is floored: gains are not over-credited and losses are not under-debited. */
export function calculateSignedPnl(priceDelta: bigint, signedQuantity: bigint): bigint {
  return multiplyFixed(priceDelta, signedQuantity, "floor");
}
