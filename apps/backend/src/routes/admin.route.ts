import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { addMarket, setMarketRisk } from "../controller/admin.controller";

const adminRouter = Router()

adminRouter.post("/market",asyncHandler(addMarket))
adminRouter.put("/market/:market_id/risk", asyncHandler(setMarketRisk))

export default adminRouter;
