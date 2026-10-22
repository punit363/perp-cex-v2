import { Router } from "express";
import {  place_order } from "../controller/order.controller";
import { authenticate } from "../middleware/auth.middleware";

const orderRouter = Router();

orderRouter.post("/",authenticate, place_order);

export default orderRouter;
