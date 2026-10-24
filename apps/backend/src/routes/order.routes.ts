import { Router } from "express";
import {  cancel_order, place_order } from "../controller/order.controller";
import { authenticate } from "../middleware/auth.middleware";

const orderRouter = Router();

orderRouter.post("/",authenticate, place_order);
orderRouter.delete("/",authenticate, cancel_order);

export default orderRouter;
