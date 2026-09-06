import type { AxiosInstance } from "axios";
import { AppError, config, ngn } from "@gateway/core";
import { httpClient, isTransportError } from "./http.js";

export interface PayoutRequest {
  idempotencyKey: string;
  amountNgn: string;
  bankAccountNumber: string;
  bankCode: string;
  reason: string;
}

export interface PayoutResult {
  accepted: boolean;
  conclusive: boolean;
  providerReference: string;
  providerStatus: string | null;
}

export class PayoutTimeoutError extends AppError {
  constructor(readonly idempotencyKey: string) {
    super("Payout provider did not respond", 504, "payout_timeout");
  }
}

export interface PayoutProvider {
  transfer(request: PayoutRequest): Promise<PayoutResult>;
  lookup(idempotencyKey: string): Promise<PayoutResult | null>;
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

function payoutResult(providerReference: string, status?: string): PayoutResult {
  const providerStatus = status?.trim().toLowerCase() || null;
  if (providerStatus === "success") {
    return { accepted: true, conclusive: true, providerReference, providerStatus };
  }
  if (["failed", "reversed", "abandoned", "blocked", "rejected"].includes(providerStatus ?? "")) {
    return { accepted: false, conclusive: true, providerReference, providerStatus };
  }
  return { accepted: false, conclusive: false, providerReference, providerStatus };
}

export class PaystackPayoutProvider implements PayoutProvider {
  private readonly http: AxiosInstance;

  constructor(secretKey = config().PAYSTACK_SECRET_KEY, http?: AxiosInstance) {
    if (!http && !secretKey) {
      throw new AppError("PAYSTACK_SECRET_KEY is not set", 500, "payout_unconfigured");
    }
    this.http =
      http ??
      httpClient({
        baseURL: "https://api.paystack.co",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" }
      });
  }

  async transfer(request: PayoutRequest): Promise<PayoutResult> {
    const recipient = await this.createRecipient(request);
    const amountKobo = ngn(request.amountNgn).units;
    if (amountKobo > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AppError("Payout amount exceeds the provider's safe integer range", 400, "payout_amount_too_large");
    }

    const { status, data: body } = await this.http
      .post<PaystackEnvelope<{ reference?: string; status?: string }>>("/transfer", {
        source: "balance",
        amount: Number(amountKobo),
        recipient,
        reason: request.reason,
        reference: request.idempotencyKey
      })
      .catch((error: unknown) => {
        if (isTransportError(error)) throw new PayoutTimeoutError(request.idempotencyKey);
        throw error;
      });

    if (status >= 400 || !body?.status || !body.data?.reference) {
      throw new AppError(body?.message ?? `Transfer failed with ${status}`, 502, "payout_rejected");
    }
    return payoutResult(body.data.reference, body.data.status);
  }

  async lookup(idempotencyKey: string): Promise<PayoutResult | null> {
    const { status, data: body } = await this.http.get<PaystackEnvelope<{ reference?: string; status?: string }>>(
      `/transfer/verify/${idempotencyKey}`,
      { timeout: 10_000 }
    );
    if (status >= 400 || !body?.status || !body.data?.reference) return null;
    return payoutResult(body.data.reference, body.data.status);
  }

  private async createRecipient(request: PayoutRequest): Promise<string> {
    const { status, data: body } = await this.http.post<PaystackEnvelope<{ recipient_code?: string }>>(
      "/transferrecipient",
      {
        type: "nuban",
        name: request.reason,
        account_number: request.bankAccountNumber,
        bank_code: request.bankCode,
        currency: "NGN"
      }
    );
    if (status >= 400 || !body?.data?.recipient_code) {
      throw new AppError(body?.message ?? "Could not create transfer recipient", 502, "payout_rejected");
    }
    return body.data.recipient_code;
  }
}

export function createPayoutProvider(): PayoutProvider {
  return new PaystackPayoutProvider();
}
