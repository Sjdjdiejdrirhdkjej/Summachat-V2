import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app: Express = express();

const isProduction = process.env["NODE_ENV"] === "production";

// Trust the first proxy hop in production so req.ip, forwarded headers,
// and secure cookies behave correctly behind a reverse proxy.
if (isProduction) {
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

// Security headers middleware (helmet-lite)
app.use((_req: Request, res: Response, next: NextFunction) => {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Enable XSS filter (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Prevent referrer leakage
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Restrict browser features
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  // HSTS in production
  if (isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  next();
});

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

// CORS configuration - strict in production, must explicitly set ALLOWED_ORIGINS
const allowedOrigins = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : isProduction
    ? [] // CRITICAL: In production, require explicit origins — deny all by default
    : ["http://localhost:5173", "http://localhost:3000"]; // Development defaults

app.use(
  cors({
    origin: isProduction
      ? allowedOrigins.length > 0
        ? allowedOrigins
        : false // In production with no config: deny ALL cross-origin requests
      : allowedOrigins.length > 0
        ? allowedOrigins
        : true, // In dev: allow all if no config
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600, // Cache preflight for 10 minutes
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" })); // Reduced from 4mb to prevent memory abuse
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many requests",
      message: "Rate limit exceeded. Please try again later.",
    });
  },
});

app.use("/api", apiLimiter, router);

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
      message: isProduction ? undefined : message,
    });
    return;
  }

  res
    .status(statusCode)
    .type("text/plain")
    .send(isProduction ? "Internal server error" : message);
});

export default app;
