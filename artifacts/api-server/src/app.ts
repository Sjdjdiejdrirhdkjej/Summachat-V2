import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the Chat UI (built assets) as the main page when present.
const srcDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(srcDir, "..");
const chatUiPublicDir = path.resolve(artifactDir, "..", "chat-ui", "dist", "public");
const chatUiIndexHtml = path.resolve(chatUiPublicDir, "index.html");

if (fs.existsSync(chatUiIndexHtml)) {
  app.use(express.static(chatUiPublicDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(chatUiIndexHtml);
  });
}

export default app;
