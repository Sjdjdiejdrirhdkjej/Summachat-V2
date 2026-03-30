import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app: Express = express();

// Replit deployments (and preview) sit behind a reverse proxy; trust the first
// hop so req.ip / forwarded headers and secure cookies behave correctly.
if (
  process.env["NODE_ENV"] === "production" &&
  process.env["REPL_ID"] !== undefined
) {
  app.set("trust proxy", 1);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown server error";
}

function isDependencyInitializationError(error: unknown): boolean {
  const message = toErrorMessage(error);
  return (
    message.includes("must be set") ||
    message.includes("Did you forget to provision") ||
    message.includes("DATABASE_URL")
  );
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

app.head("/", (_req, res) => {
  res.status(200).end();
});

app.use("/api", router);

// Serve the Chat UI (built assets) as the main page when present.
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(srcDir, "..");
const chatUiPublicDir = path.resolve(
  artifactDir,
  "..",
  "chat-ui",
  "dist",
  "public",
);
const chatUiIndexHtml = path.resolve(chatUiPublicDir, "index.html");

if (fs.existsSync(chatUiIndexHtml)) {
  app.use(express.static(chatUiPublicDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(chatUiIndexHtml);
  });
}

app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = isDependencyInitializationError(error) ? 503 : 500;
  const message = toErrorMessage(error);

  logger.error(
    {
      err: error,
      method: req.method,
      url: req.originalUrl,
      statusCode,
    },
    "Unhandled request error",
  );

  if (req.path.startsWith("/api")) {
    res.status(statusCode).json({
      error:
        statusCode === 503
          ? "Service temporarily unavailable"
          : "Internal server error",
      message,
    });
    return;
  }

  res.status(statusCode).type("text/plain").send(message);
});

export default app;
