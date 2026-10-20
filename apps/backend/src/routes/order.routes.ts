import { Router } from "express";
import { on_ramp, place_order } from "../controller/order.controller";
import { authenticate } from "../middleware/auth.middleware";

const orderRouter = Router();

orderRouter.use("/onramp",authenticate, on_ramp);
orderRouter.use("/",authenticate, place_order);

export default orderRouter;
