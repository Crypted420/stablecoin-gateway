import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { NETWORKS, TOKENS, badRequest, config, conflict, notFound } from "@gateway/core";
import { deriveDepositAddress, isSupportedAsset } from "@gateway/chain";
import { invoices, isUniqueViolation, payments, settlements, withTransaction } from "@gateway/db";
import { createChainAddressRegistrar } from "@gateway/providers";
import { merchantId, type MerchantRequest } from "../middleware/merchant.js";

const createSchema = z.object({
  reference: z.string().min(1).max(64),
  amountExpected: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, "Amount must be a positive decimal")
    .refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  tokenSymbol: z.enum(TOKENS),
  network: z.enum(NETWORKS)
});

export const invoiceRouter: ExpressRouter = Router({ mergeParams: true });

invoiceRouter.post("/", async (req: MerchantRequest, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    if (!isSupportedAsset(input.network, input.tokenSymbol)) {
      return next(badRequest(`${input.tokenSymbol} is not supported on ${input.network}`, "unsupported_asset"));
    }
    const invoice = await withTransaction(async (client) => {
      const index = await invoices.nextDerivationIndex(client);
      const expiresAt = new Date(Date.now() + config().INVOICE_TTL_MINUTES * 60_000);
      const depositAddress = deriveDepositAddress(index);
      const registrar = createChainAddressRegistrar();
      if (registrar) await registrar.addAddresses(input.network, [depositAddress]);
      return invoices.insertInvoice(
        {
          merchantId: merchantId(req),
          reference: input.reference,
          amountExpected: input.amountExpected,
          tokenSymbol: input.tokenSymbol,
          network: input.network,
          depositAddress,
          derivationIndex: index,
          expiresAt
        },
        client
      );
    });
    res.status(201).json({ invoice });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return next(conflict("An invoice with that reference already exists", "reference_taken"));
    }
    next(error);
  }
});

invoiceRouter.get("/", async (req: MerchantRequest, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit ?? 50) || 50);
    res.json({ invoices: await invoices.listInvoices(merchantId(req), limit) });
  } catch (error) {
    next(error);
  }
});

invoiceRouter.get("/:id", async (req: MerchantRequest, res, next) => {
  try {
    const id = req.params.id;
    if (!id) return next(badRequest("An invoice id is required"));

    const invoice = await invoices.findInvoiceById(id);
    if (!invoice || invoice.merchantId !== merchantId(req)) return next(notFound("No such invoice"));

    const payment = await payments.findPaymentByInvoice(invoice.id);
    const settlement = payment ? await settlements.findSettlementByPayment(payment.id) : null;
    res.json({ invoice, payment, settlement });
  } catch (error) {
    next(error);
  }
});
