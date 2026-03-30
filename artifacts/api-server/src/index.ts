import app from "./app";
import { logger } from "./lib/logger";

// Default to 8080 so Replit artifacts, deployment, and the Chat UI proxy all agree.
const rawPort = process.env["PORT"] ?? "8080";
const host = process.env["HOST"] ?? "0.0.0.0";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, host, () => {
  logger.info({ host, port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Server listen error");
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutdown signal received, closing server");
  server.close((closeErr) => {
    if (closeErr) {
      logger.error({ err: closeErr }, "Error closing server");
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Shutdown timed out, exiting");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled rejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception, shutting down");
  process.exit(1);
});
