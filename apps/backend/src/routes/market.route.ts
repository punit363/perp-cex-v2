import { Router } from "express";
import { get_depth } from "../controller/market.controller";

const marketRouter = Router();

marketRouter.get("/depth/:market_id", get_depth);

export default marketRouter