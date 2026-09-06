import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { badRequest, config, notFound } from "@gateway/core";
import { settlements, sweeps } from "@gateway/db";
import { requireAdmin } from "../middleware/admin.js";
import { executePayout } from "../payout-bridge.js";
import { fundDepositWallet, runWalletSweeps, sweepDepositWallet } from "../sweep-bridge.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { runReconciliation } from "../reconciliation-bridge.js";

export const adminRouter: ExpressRouter = Router();
adminRouter.use(rateLimit(60_000, 60));
adminRouter.use(requireAdmin);

const reconciliationSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime()
});

adminRouter.get("/overview", async (_req, res, next) => {
  try {
    res.json({
      ...(await sweeps.overview()),
      treasuryAddress: config().TREASURY_ADDRESS || null,
      treasuryConfigured: Boolean(config().TREASURY_ADDRESS),
      gasWalletConfigured: Boolean(config().SWEEP_GAS_PRIVATE_KEY)
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/wallets", async (req, res, next) => {
  try {
    const requested = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, Math.trunc(requested))) : 100;
    res.json({ wallets: await sweeps.listCandidates(limit) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/wallets/:paymentId/fund", async (req, res, next) => {
  try {
    const paymentId = req.params.paymentId;
    if (!paymentId) return next(badRequest("A payment id is required"));
    const outcome = await fundDepositWallet(paymentId);
    if (!outcome.ok) return res.status(502).json({ error: "wallet_funding_failed", message: outcome.message });
    res.json(outcome.data);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/wallets/:paymentId/sweep", async (req, res, next) => {
  try {
    const paymentId = req.params.paymentId;
    if (!paymentId) return next(badRequest("A payment id is required"));
    const outcome = await sweepDepositWallet(paymentId);
    if (!outcome.ok) return res.status(502).json({ error: "wallet_sweep_failed", message: outcome.message });
    res.json(outcome.data);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/wallets/run", async (req, res, next) => {
  try {
    const action = z.enum(["fund", "sweep"]).parse(req.body?.action);
    const outcome = await runWalletSweeps(action);
    if (!outcome.ok) return res.status(502).json({ error: "wallet_batch_failed", message: outcome.message });
    res.json(outcome.data);
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/payouts/pending", async (_req, res, next) => {
  try {
    res.json({ settlements: await settlements.actionablePayouts() });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/reconciliation/run", async (req, res, next) => {
  try {
    const { periodStart, periodEnd } = reconciliationSchema.parse(req.body);
    if (new Date(periodStart).getTime() >= new Date(periodEnd).getTime()) {
      return next(badRequest("periodStart must be before periodEnd"));
    }
    const outcome = await runReconciliation(periodStart, periodEnd);
    if (!outcome.ok || !outcome.report) {
      return res.status(502).json({
        error: "reconciliation_failed",
        message: outcome.message ?? "Worker did not return a reconciliation report"
      });
    }
    res.json(outcome.report);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/payouts/:id/retry", async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!id) return next(badRequest("A settlement id is required"));
    const settlement = await settlements.findSettlementById(id);
    if (!settlement || settlement.status !== "failed") {
      return next(notFound("No failed payout is available under that id"));
    }
    const outcome = await executePayout(id);
    if (!outcome.ok) {
      return res.status(502).json({
        error: "payout_failed",
        message: outcome.message,
        settlement: await settlements.findSettlementById(id)
      });
    }
    res.json({ settlement: await settlements.findSettlementById(id) });
  } catch (error) {
    next(error);
  }
});
