import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";

const router: IRouter = Router();
const isProduction = process.env["NODE_ENV"] === "production";

router.use(healthRouter);

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown route initialization error";
}

function lazyRoute(
  load: () => Promise<{ default: RequestHandler }>,
): RequestHandler {
  let loadedRouter: RequestHandler | null = null;
  let loadingPromise: Promise<RequestHandler> | null = null;

  return async (req, res, next) => {
    if (!loadedRouter) {
      try {
        loadingPromise ??= load()
          .then((module) => module.default)
          .catch((error) => {
            loadingPromise = null;
            throw error;
          });
        loadedRouter = await loadingPromise;
      } catch (error) {
        if (res.headersSent) {
          next(error);
          return;
        }

        res.status(503).json({
          error: "Service temporarily unavailable",
          message: isProduction ? undefined : toErrorMessage(error),
        });
        return;
      }
    }

    try {
      loadedRouter(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

router.use(
  "/images",
  lazyRoute(() => import("./images")),
);
router.use(lazyRoute(() => import("./chat")));
router.use(lazyRoute(() => import("./multi-chat")));
router.use(
  "/research",
  lazyRoute(() => import("./research")),
);

export default router;
