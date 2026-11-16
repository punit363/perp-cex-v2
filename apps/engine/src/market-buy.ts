import { calculateFee, calculateInitialMargin, calculateNotional } from "./math/financial-math";
import { min } from "./utils";

export type MarketBuyLiquidity = { price: bigint; quantity: bigint };

export function planMarketBuy(
  liquidity: MarketBuyLiquidity[],
  available: bigint,
  leverage: bigint,
  closingQuantity: bigint,
  takerFeeRate: bigint
): { quantity: bigint; margin: bigint; fee: bigint } {
  let quantity = 0n;
  let margin = 0n;
  let fee = 0n;

  for (const level of liquidity) {
    const costFor = (fillQuantity: bigint) => {
      const opening = fillQuantity - min(closingQuantity, fillQuantity);
      return {
        margin: calculateInitialMargin(
          calculateNotional(level.price, opening),
          leverage
        ),
        fee: calculateFee(
          calculateNotional(level.price, fillQuantity),
          takerFeeRate
        ),
      };
    };

    const fullCost = costFor(level.quantity);
    let affordable = level.quantity;
    if (margin + fee + fullCost.margin + fullCost.fee > available) {
      let low = 0n;
      let high = level.quantity;
      while (low < high) {
        const middle = (low + high + 1n) / 2n;
        const cost = costFor(middle);
        if (margin + fee + cost.margin + cost.fee <= available) {
          low = middle;
        } else {
          high = middle - 1n;
        }
      }
      affordable = low;
    }
    if (affordable === 0n) break;
    const cost = affordable === level.quantity ? fullCost : costFor(affordable);
    margin += cost.margin;
    fee += cost.fee;
    quantity += affordable;
    closingQuantity -= min(closingQuantity, affordable);
    if (affordable < level.quantity) break;
  }

  return { quantity, margin, fee };
}
