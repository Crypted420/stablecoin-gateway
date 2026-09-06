import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { badRequest, notFound } from "@gateway/core";
import { merchants } from "@gateway/db";
import { bankDirectory } from "../bank-directory.js";
import { assertSafeWebhookUrl } from "@gateway/providers";
import { rateLimit } from "../middleware/rate-limit.js";

const resolveSchema = z.object({
  bankAccountNumber: z.string().regex(/^\d{10}$/, "A Nigerian account number is 10 digits"),
  bankCode: z.string().regex(/^\d{3,6}$/, "Choose a bank from the list")
});

const webhookSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:", "Webhook URLs must use HTTPS")
    .nullable()
});

export const merchantRouter: ExpressRouter = Router();

merchantRouter.post("/resolve", rateLimit(60_000, 20), async (req, res, next) => {
  try {
    const input = resolveSchema.parse(req.body);
    const account = await bankDirectory().resolveAccount(input.bankAccountNumber, input.bankCode);
    const merchant = await merchants.upsertMerchant({
      accountName: account.accountName,
      bankAccountNumber: account.accountNumber,
      bankName: account.bankName,
      bankCode: account.bankCode,
      accountVerified: true
    });
    res.json({ merchant });
  } catch (error) {
    next(error);
  }
});

merchantRouter.get("/:merchantId", async (req, res, next) => {
  try {
    const id = req.params.merchantId;
    if (!id) return next(badRequest("A merchant id is required"));
    const merchant = await merchants.findMerchantById(id);
    if (!merchant) return next(notFound("No such merchant"));
    res.json({ merchant });
  } catch (error) {
    next(error);
  }
});

merchantRouter.post("/:merchantId/webhook", async (req, res, next) => {
  try {
    const id = req.params.merchantId;
    if (!id) return next(badRequest("A merchant id is required"));
    const { webhookUrl } = webhookSchema.parse(req.body);
    if (webhookUrl) await assertSafeWebhookUrl(webhookUrl);
    const merchant = await merchants.updateWebhookUrl(id, webhookUrl);
    if (!merchant) return next(notFound("No such merchant"));
    res.json({ merchant });
  } catch (error) {
    next(error);
  }
});
