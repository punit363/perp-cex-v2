import { Router } from "express";
import { get_depth, get_position } from "../controller/market.controller";
import { authenticate } from "../middleware/auth.middleware";

const marketRouter = Router();

marketRouter.get("/depth/:market_id", get_depth);
marketRouter.get("/position/:market_id", authenticate, get_position);

export default marketRouter;
