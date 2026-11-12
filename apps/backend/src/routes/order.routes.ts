import { Router } from "express";
import { list_orders, cancel_order, place_order } from "../controller/order.controller";
import { authenticate } from "../middleware/auth.middleware";
import { demoRateLimit } from "../middleware/demo-rate-limit";

const orderRouter = Router();
const orderRateLimit = demoRateLimit(120, 60_000, (request) => request.user_id || "unknown");

orderRouter.get("/", authenticate, list_orders);
orderRouter.post("/",authenticate, orderRateLimit, place_order);
orderRouter.delete("/",authenticate, orderRateLimit, cancel_order);

export default orderRouter;
