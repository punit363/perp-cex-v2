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
};

export default MARKET_CONFIG;
