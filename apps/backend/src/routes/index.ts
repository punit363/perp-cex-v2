import { Router } from "express";
import adminRouter from "./admin.route";
import authRouter from "./auth.route";
import orderRouter from "./order.routes";

const apiRouter = Router()

apiRouter.use("/admin",adminRouter);
apiRouter.use("/auth",authRouter);
apiRouter.use("/order",orderRouter);

export default apiRouter;