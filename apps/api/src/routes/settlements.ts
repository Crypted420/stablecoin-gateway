import { Router, type Router as ExpressRouter } from "express";
import { badRequest, notFound } from "@gateway/core";
import { ledger, settlements } from "@gateway/db";
import { merchantId, type MerchantRequest } from "../middleware/merchant.js";

export const settlementRouter: ExpressRouter = Router({ mergeParams: true });

settlementRouter.get("/", async (req: MerchantRequest, res, next) => {
  try {
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
    res.json({ settlements: await settlements.listSettlements(merchantId(req), limit) });
  } catch (error) {
    next(error);
  }
});

settlementRouter.get("/:id/ledger", async (req: MerchantRequest, res, next) => {
  try {
    const id = req.params.id;
    if (!id) return next(badRequest("A settlement id is required"));
    const entries = await ledger.entriesForMerchantSettlement(merchantId(req), id);
    if (!entries) return next(notFound("No such settlement"));
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});
