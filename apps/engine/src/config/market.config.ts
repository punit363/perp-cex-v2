import { parseFixed } from "../math/fixed-point";
import { MARKET_DEFAULTS } from "./constants";

const MARKET_CONFIG = {
  COLLATERAL_ASSET:
    process.env.COLLATERAL_ASSET || MARKET_DEFAULTS.COLLATERAL_ASSET,
  LEVERAGE_LIMIT: process.env.LEVERAGE_LIMIT,
  // OKX regular-user perpetual defaults. Keep configurable per deployment.
  MAKER_FEE_RATE: parseFixed(
    process.env.MAKER_FEE_RATE || MARKET_DEFAULTS.MAKER_FEE_RATE
  ),
  TAKER_FEE_RATE: parseFixed(
    process.env.TAKER_FEE_RATE || MARKET_DEFAULTS.TAKER_FEE_RATE
  ),
  LIQUIDATION_FEE_RATE: parseFixed(
    process.env.LIQUIDATION_FEE_RATE ||
      process.env.TAKER_FEE_RATE ||
      MARKET_DEFAULTS.TAKER_FEE_RATE
  ),
  INSURANCE_FUND_INITIAL_BALANCE: parseFixed(
    process.env.INSURANCE_FUND_INITIAL_BALANCE ||
      MARKET_DEFAULTS.INSURANCE_FUND_INITIAL_BALANCE
  ),
  SATOSHI_SCALE: process.env.SATOSHI_SCALE,
  MAINTENANCE_MARGIN_RATE: parseFixed(
    process.env.MAINTENANCE_MARGIN_RATE ||
      MARKET_DEFAULTS.MAINTENANCE_MARGIN_RATE
  ),
  MAX_MARK_PRICE_AGE_MS: Number(
    process.env.MAX_MARK_PRICE_AGE_MS || MARKET_DEFAULTS.MAX_MARK_PRICE_AGE_MS
  ),
};

export default MARKET_CONFIG;
