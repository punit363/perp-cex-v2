import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { addMarket, setMarketRisk, setFundingRate } from "../controller/admin.controller";

const adminRouter = Router()

adminRouter.post("/market",asyncHandler(addMarket))
adminRouter.put("/market/:market_id/risk", asyncHandler(setMarketRisk))
adminRouter.put("/market/:market_id/funding", asyncHandler(setFundingRate))

export default adminRouter;
