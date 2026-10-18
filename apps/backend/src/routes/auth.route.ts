import { Router } from "express";
import { signin, signup } from "../controller/auth.controller";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.post("/signup", asyncHandler(signup));
router.post("/signin", asyncHandler(signin));

export default router;
