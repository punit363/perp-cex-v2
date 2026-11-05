import { Router } from "express";
import { get_balance, on_ramp } from "../controller/user.controller";
import { authenticate } from "../middleware/auth.middleware";
import { demoRateLimit } from "../middleware/demo-rate-limit";

const userRouter = Router();

userRouter.get("/balance",authenticate, get_balance);
userRouter.post("/onramp",authenticate, demoRateLimit(20, 60 * 60_000, (request) => request.user_id || "unknown"), on_ramp);

export default userRouter;
