import { PositionType } from "commons/src/order.type";
import { divideFixed, divideRounded, multiplyFixed } from "../math/fixed-point";

const calcAvgPrice = (
  currentAvg: bigint,
  currentQty: bigint,
  entryPrice: bigint,
  newQty: bigint
) => {
  if (currentAvg < 0n || currentQty < 0n || entryPrice < 0n || newQty < 0n) {
    throw new Error(
      "Current avg, current quantity, entry price and new quantity must be non-negative"
    );
  }
  const totalQty = currentQty + newQty;
  if (totalQty === 0n) {
    throw new Error("Total position quantity must be positive");
  }

  // Both prices and quantities use the same scale, which cancels in this ratio.
  return divideRounded(
    currentAvg * currentQty + entryPrice * newQty,
    totalQty,
    "floor"
  );
};

const calcUnrealisedPnL = (
  type: PositionType,
  current_market_price: bigint,
  avg_price: bigint,
  qty: bigint
) => {
  if (current_market_price < 0n || avg_price < 0n || qty < 0n) {
    throw new Error(
      "Current market price, average price and qty must be non-negative"
    );
  }

  let unrealisedPnL;

  if (type == PositionType.LONG) {
    unrealisedPnL = multiplyFixed(
      qty,
      current_market_price - avg_price,
      "floor"
    );
  } else {
    unrealisedPnL = multiplyFixed(
      qty,
      avg_price - current_market_price,
      "floor"
    );
  }

  return unrealisedPnL;
};

/** Zero-equity price only; maintenance margin, fees, and funding are not included. */
const bankruptcyPrice = (
  type: PositionType,
  avg_price: bigint,
  margin: bigint,
  qty: bigint
) => {
  if (margin < 0n || avg_price < 0n || qty <= 0n) {
    throw new Error("Margin, average price and qty must be non-negative");
  }

  let price;

  if (type == PositionType.LONG) {
    price = avg_price - divideFixed(margin, qty, "floor");
  } else {
    price = avg_price + divideFixed(margin, qty, "floor");
  }

  return price;
};

export { calcAvgPrice, calcUnrealisedPnL, bankruptcyPrice };
