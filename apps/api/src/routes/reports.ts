import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { settlements } from "@gateway/db";
import { merchantId, type MerchantRequest } from "../middleware/merchant.js";

const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json")
});

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const reportRouter: ExpressRouter = Router({ mergeParams: true });

reportRouter.get("/settlements", async (req: MerchantRequest, res, next) => {
  try {
    const query = rangeSchema.parse(req.query);
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    const rows = await settlements.settlementsInPeriod(merchantId(req), from, to);

    if (query.format === "csv") {
      const header = "reference,tx_hash,amount_ngn,rate,status,provider_reference,completed_at";
      const body = rows.map((r) =>
        [
          r.reference,
          r.txHash,
          r.amountNgn,
          r.quoteRate ?? "par",
          r.status,
          r.providerReference ?? "",
          r.completedAt ?? ""
        ]
          .map((v) => csvEscape(String(v)))
          .join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="settlements.csv"');
      res.send([header, ...body].join("\n"));
      return;
    }

    res.json({ from: from.toISOString(), to: to.toISOString(), settlements: rows });
  } catch (error) {
    next(error);
  }
});
