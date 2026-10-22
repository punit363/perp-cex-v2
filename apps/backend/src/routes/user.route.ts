import { Router } from "express";
import { get_balance, on_ramp } from "../controller/user.controller";
import { authenticate } from "../middleware/auth.middleware";

const userRouter = Router();

userRouter.get("/balance",authenticate, get_balance);
userRouter.post("/onramp",authenticate, on_ramp);

export default userRouter;
