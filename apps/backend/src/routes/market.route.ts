import { Router } from "express";
import { list_markets, get_market, get_depth, get_position } from "../controller/market.controller";
import { authenticate } from "../middleware/auth.middleware";

const marketRouter = Router();

marketRouter.get("/", list_markets);
marketRouter.get("/depth/:market_id", get_depth);
marketRouter.get("/position/:market_id", authenticate, get_position);
marketRouter.get("/:market_id", get_market);

export default marketRouter;
