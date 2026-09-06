import type { NextFunction, Request, Response } from "express";
import { AppError, notFound } from "@gateway/core";
import { merchants } from "@gateway/db";

export interface MerchantRequest extends Request {
  merchantId?: string;
}

export async function resolveMerchant(
  req: MerchantRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const id = req.params.merchantId;
  if (!id) return next(notFound("No merchant was identified"));
  const merchant = await merchants.findMerchantById(id).catch(() => null);
  if (!merchant) return next(notFound("No such merchant"));
  if (merchant.status !== "active") return next(new AppError("Merchant is suspended", 403, "merchant_suspended"));
  req.merchantId = merchant.id;
  next();
}

export function merchantId(req: MerchantRequest): string {
  if (!req.merchantId) throw notFound("No merchant was identified");
  return req.merchantId;
}
