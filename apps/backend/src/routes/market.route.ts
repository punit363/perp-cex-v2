import { Router } from "express";
import { list_markets, get_market, get_market_trades, get_market_candles, get_depth, get_position } from "../controller/market.controller";
import { authenticate } from "../middleware/auth.middleware";

const marketRouter = Router();

marketRouter.get("/", list_markets);
marketRouter.get("/depth/:market_id", get_depth);
marketRouter.get("/position/:market_id", authenticate, get_position);
marketRouter.get("/:market_id/trades", get_market_trades);
marketRouter.get("/:market_id/candles", get_market_candles);
marketRouter.get("/:market_id", get_market);

export default marketRouter;
