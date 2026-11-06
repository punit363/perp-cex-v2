import { PositionType } from "commons/src/order.type";
import type { Position } from "./types";
import { divideRounded } from "./math/fixed-point";
import { FIXED_POINT_CONSTANTS, LIQUIDATION_CONSTANTS } from "./constants";
import {
  calculateFee,
  calculateMaintenanceMargin,
  calculateNotional,
} from "./math/financial-math";
import { calcUnrealisedPnL } from "./perp";

// Calculate the position's liquidation risk at the current mark price.
export const calculatePositionRisk = (
  position: Position,
  markPrice: bigint,
  maintenanceRate: bigint,
  liquidationFeeRate: bigint
) => {
  const unrealizedPnl = calcUnrealisedPnL(
    position.type,
    markPrice,
    position.avg_entry_price,
    position.quantity
  );
  const notional = calculateNotional(markPrice, position.quantity);
  const equity =
    position.reserved_margin + unrealizedPnl + position.funding_accrued;
  const maintenanceMargin = calculateMaintenanceMargin(
    notional,
    maintenanceRate
  );
  const estimatedCloseFee = calculateFee(notional, liquidationFeeRate);
  const requirement = maintenanceMargin + estimatedCloseFee;
  return {
    unrealizedPnl,
    notional,
    equity,
    maintenanceMargin,
    estimatedCloseFee,
    requirement,
    liquidatable: equity <= requirement,
  };
};

// Calculate the equity and fee attributable to one liquidation fill.
export const calculateLiquidationFill = (
  position: Position,
  filled: bigint,
  executionPrice: bigint,
  liquidationFeeRate: bigint
) => {
  if (filled <= 0n || filled > position.quantity) {
    throw new Error("Liquidation fill exceeds remaining position quantity");
  }
  const finalFill = filled === position.quantity;
  //calculate margin used by this fill
  const allocatedMargin = finalFill
    ? position.reserved_margin
    : divideRounded(
        position.reserved_margin * filled,
        position.quantity,
        "floor"
      );

  //calculate funding rate amount for this fill
  const allocatedFunding = finalFill
    ? position.funding_accrued
    : divideRounded(
        position.funding_accrued * filled,
        position.quantity,
        "floor"
      );
  const realizedPnl = calcUnrealisedPnL(
    position.type,
    executionPrice,
    position.avg_entry_price,
    filled
  );

  // Calculate the requested liquidation fee for this fill.
  const requestedFee = calculateFee(
    calculateNotional(executionPrice, filled),
    liquidationFeeRate
  );
  return {
    allocatedMargin,
    allocatedFunding,
    realizedPnl,
    requestedFee,
    executionEquity: allocatedMargin + realizedPnl + allocatedFunding,
  };
};

/** Threshold on the scaled mark-price grid where maintenance plus close fee is met. */
export const calculateLiquidationPrice = (
  position: Position,
  maintenanceRate: bigint,
  liquidationFeeRate: bigint
): bigint | null => {
  if (
    position.quantity <= 0n ||
    maintenanceRate + liquidationFeeRate >= FIXED_POINT_CONSTANTS.SCALE
  ) {
    return null;
  }
  const liquidatable = (price: bigint) =>
    calculatePositionRisk(position, price, maintenanceRate, liquidationFeeRate)
      .liquidatable;
  const minimumPrice = 1n;
  if (position.type === PositionType.LONG) {
    if (!liquidatable(minimumPrice)) return null;
    let low = minimumPrice;
    let high =
      position.avg_entry_price > 0n ? position.avg_entry_price * 2n : 2n;
    for (
      let i = 0;
      i < LIQUIDATION_CONSTANTS.PRICE_SEARCH_MAX_DOUBLINGS &&
      liquidatable(high);
      i++
    )
      high *= 2n;
    if (liquidatable(high)) return null;
    while (high - low > 1n) {
      const middle = (low + high) / 2n;
      if (liquidatable(middle)) low = middle;
      else high = middle;
    }
    return low;
  }

  if (liquidatable(minimumPrice)) return minimumPrice;
  let low = minimumPrice;
  let high = position.avg_entry_price > 0n ? position.avg_entry_price * 2n : 2n;
  for (
    let i = 0;
    i < LIQUIDATION_CONSTANTS.PRICE_SEARCH_MAX_DOUBLINGS && !liquidatable(high);
    i++
  )
    high *= 2n;
  if (!liquidatable(high)) return null;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (liquidatable(middle)) high = middle;
    else low = middle;
  }
  return high;
};
