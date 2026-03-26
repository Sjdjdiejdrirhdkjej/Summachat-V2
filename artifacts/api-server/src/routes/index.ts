import { Router, type IRouter } from "express";
import healthRouter from "./health";
import multiChatRouter from "./multi-chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(multiChatRouter);

export default router;
