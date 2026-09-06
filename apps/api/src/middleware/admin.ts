import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "@gateway/core";

export const requireAdmin: RequestHandler = (req, res, next) => {
  const configured = config().ADMIN_API_KEY;
  if (!configured) {
    res.status(503).json({ error: "admin_unconfigured", message: "ADMIN_API_KEY is not configured" });
    return;
  }
  const supplied = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const suppliedBytes = Buffer.from(supplied);
  const configuredBytes = Buffer.from(configured);
  const valid =
    suppliedBytes.length === configuredBytes.length &&
    timingSafeEqual(suppliedBytes, configuredBytes);
  if (!valid) {
    res.status(401).json({ error: "unauthorized", message: "A valid admin key is required" });
    return;
  }
  next();
};
