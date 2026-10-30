import { parseFixed } from "../math/fixed-point";

const MARKET_CONFIG = {
  COLLATERAL_ASSET: process.env.COLLATERAL_ASSET,
  LEVERAGE_LIMIT: process.env.LEVERAGE_LIMIT,
  MAKER_FEE: process.env.MAKER_FEE,
  TAKER_FEE: process.env.TAKER_FEE,
  SATOSHI_SCALE: process.env.SATOSHI_SCALE,
  MAINTENANCE_MARGIN_RATE: parseFixed(
    process.env.MAINTENANCE_MARGIN_RATE || "0.005"
  ),
  MAX_MARK_PRICE_AGE_MS: Number(process.env.MAX_MARK_PRICE_AGE_MS || "5000"),
  MAX_MARK_PRICE_CLOCK_SKEW_MS: Number(
    process.env.MAX_MARK_PRICE_CLOCK_SKEW_MS || "1000"
  ),
};

export default MARKET_CONFIG;
