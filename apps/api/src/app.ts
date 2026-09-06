import cors from "cors";
import express, { type Express } from "express";
import { resolveMerchant } from "./middleware/merchant.js";
import { bankRouter } from "./routes/banks.js";
import { invoiceRouter } from "./routes/invoices.js";
import { merchantRouter } from "./routes/merchants.js";
import { reportRouter } from "./routes/reports.js";
import { settlementRouter } from "./routes/settlements.js";
import { systemRouter } from "./routes/system.js";
import { adminRouter } from "./routes/admin.js";
import { alchemyRouter } from "./routes/alchemy.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { config } from "@gateway/core";

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: config().CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      methods: ["GET", "POST", "OPTIONS"]
    })
  );
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (config().ENFORCE_HTTPS === "true" && !req.secure) {
      res.status(426).json({ error: "https_required", message: "HTTPS is required" });
      return;
    }
    next();
  });
  app.use(
    "/api/webhooks/alchemy",
    express.raw({ type: "application/json", limit: "512kb" }),
    alchemyRouter
  );
  app.use(express.json({ limit: "256kb" }));

  app.use("/api/banks", bankRouter);
  app.use("/api/merchants", merchantRouter);
  app.use("/api/merchants/:merchantId/invoices", resolveMerchant, invoiceRouter);
  app.use("/api/merchants/:merchantId/settlements", resolveMerchant, settlementRouter);
  app.use("/api/merchants/:merchantId/reports", resolveMerchant, reportRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
