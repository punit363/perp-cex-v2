import { parseFixed } from "../math/fixed-point";

const MARKET_CONFIG = {
  COLLATERAL_ASSET: process.env.COLLATERAL_ASSET || "USDT",
  LEVERAGE_LIMIT: process.env.LEVERAGE_LIMIT,
  // OKX regular-user perpetual defaults. Keep configurable per deployment.
  MAKER_FEE_RATE: parseFixed(process.env.MAKER_FEE_RATE || "0.0002"),
  TAKER_FEE_RATE: parseFixed(process.env.TAKER_FEE_RATE || "0.0005"),
  LIQUIDATION_FEE_RATE: parseFixed(
    process.env.LIQUIDATION_FEE_RATE || process.env.TAKER_FEE_RATE || "0.0005"
  ),
  INSURANCE_FUND_INITIAL_BALANCE: parseFixed(
    process.env.INSURANCE_FUND_INITIAL_BALANCE || "0"
  ),
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
