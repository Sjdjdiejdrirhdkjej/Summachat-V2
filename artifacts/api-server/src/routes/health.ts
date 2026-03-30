import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function sendOkStatus(res: { json: (body: unknown) => void }) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

router.get("/healthz", (_req, res) => {
  sendOkStatus(res);
});

router.head("/healthz", (_req, res) => {
  res.status(200).end();
});

router.get("/readyz", (_req, res) => {
  sendOkStatus(res);
});

router.head("/readyz", (_req, res) => {
  res.status(200).end();
});

export default router;
