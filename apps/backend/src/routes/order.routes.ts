import { Router } from "express";
import { list_orders, cancel_order, place_order } from "../controller/order.controller";
import { authenticate } from "../middleware/auth.middleware";

const orderRouter = Router();

orderRouter.get("/", authenticate, list_orders);
orderRouter.post("/",authenticate, place_order);
orderRouter.delete("/",authenticate, cancel_order);

export default orderRouter;
