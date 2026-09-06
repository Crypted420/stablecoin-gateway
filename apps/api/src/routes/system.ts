import { Router, type Router as ExpressRouter } from "express";
import { metrics } from "@gateway/core";
import { db, events, outbox, reconciliation } from "@gateway/db";
import { supportedAssets } from "@gateway/chain";
import axios from "axios";
import { config } from "@gateway/core";
import { requireAdmin } from "../middleware/admin.js";

export const systemRouter: ExpressRouter = Router();

systemRouter.get("/assets", (_req, res) => {
  res.json({ assets: supportedAssets() });
});

systemRouter.get("/health", async (_req, res) => {
  try {
    await db().query("SELECT 1");
    const worker = await axios
      .get(`${config().WORKER_CONTROL_URL}/health`, { timeout: 1500, validateStatus: () => true })
      .then((response) => (response.status === 200 ? "up" : "degraded"))
      .catch(() => "down");
    res.status(worker === "up" ? 200 : 503).json({
      status: worker === "up" ? "ok" : "degraded",
      database: "up",
      worker
    });
  } catch {
    res.status(503).json({ status: "degraded", database: "down", worker: "unknown" });
  }
});

systemRouter.get("/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(metrics.renderPrometheus());
});

systemRouter.get("/metrics.json", requireAdmin, (_req, res) => {
  res.json(metrics.summary());
});

systemRouter.get("/reconciliation", requireAdmin, async (_req, res, next) => {
  try {
    const report = await reconciliation.latest();
    res.status(report ? 200 : 404).json(report ?? { error: "no_reconciliation_report" });
  } catch (error) {
    next(error);
  }
});

systemRouter.get("/outbox", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ pending: await outbox.pendingCount() });
  } catch (error) {
    next(error);
  }
});

systemRouter.get("/dead-letters", requireAdmin, async (_req, res, next) => {
  try {
    res.json({ deadLetters: await events.listDeadLetters() });
  } catch (error) {
    next(error);
  }
});
