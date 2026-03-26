import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import multiChatRouter from "./multi-chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(multiChatRouter);

export default router;
