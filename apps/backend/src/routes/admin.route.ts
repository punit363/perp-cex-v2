import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { addMarket } from "../controller/admin.controller";

const adminRouter = Router()

adminRouter.post("/market",asyncHandler(addMarket))

export default adminRouter;