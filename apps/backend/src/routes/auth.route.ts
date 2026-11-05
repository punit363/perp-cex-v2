import { Router } from "express";
import { signin, signup } from "../controller/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { demoRateLimit } from "../middleware/demo-rate-limit";

const authRouter = Router();
authRouter.use(demoRateLimit(30, 15 * 60_000, (request) => request.ip || "unknown"));

authRouter.post("/signup", asyncHandler(signup));
authRouter.post("/signin", asyncHandler(signin));

export default authRouter;
