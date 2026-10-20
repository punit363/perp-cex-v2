import { Router } from "express";
import { signin, signup } from "../controller/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

const authRouter = Router();

authRouter.post("/signup", asyncHandler(signup));
authRouter.post("/signin", asyncHandler(signin));

export default authRouter;
