import { beforeEach, describe, expect, it, vi } from "vitest";
import { newEnvelope, type QuoteLocked } from "@gateway/core";

const mocks = vi.hoisted(() => ({
  beginAttempt: vi.fn(),
  markSubmitted: vi.fn(),
  markProviderFailed: vi.fn(),
  submittedSettlements: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  findSettlementById: vi.fn(),
  findMerchantById: vi.fn(),
  findPaymentById: vi.fn(),
  findInvoiceById: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  enqueue: vi.fn()
}));

vi.mock("@gateway/db", () => ({
  settlements: {
    beginAttempt: mocks.beginAttempt,
    markSubmitted: mocks.markSubmitted,
    markProviderFailed: mocks.markProviderFailed,
    submittedSettlements: mocks.submittedSettlements,
    markCompleted: mocks.markCompleted,
    markFailed: mocks.markFailed,
    findSettlementById: mocks.findSettlementById
  },
  merchants: { findMerchantById: mocks.findMerchantById },
  payments: { findPaymentById: mocks.findPaymentById },
  invoices: { updateInvoiceStatus: mocks.updateInvoiceStatus, findInvoiceById: mocks.findInvoiceById },
  outbox: { enqueue: mocks.enqueue },
  withTransaction: async (fn: (client: object) => Promise<unknown>) => fn({})
}));

import { SettlementService } from "./services/settlement.js";

const event: QuoteLocked = {
  ...newEnvelope(),
  name: "QuoteLocked",
  settlementId: "11111111-1111-4111-8111-111111111111",
  paymentId: "22222222-2222-4222-8222-222222222222",
  merchantId: "33333333-3333-4333-8333-333333333333",
  rate: "1500.00000000",
  amountNgn: "1500.00"
};

describe("SettlementService crash recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginAttempt.mockResolvedValue({ id: event.settlementId, attempts: 2 });
    mocks.findMerchantById.mockResolvedValue({
      id: event.merchantId,
      bankAccountNumber: "0123456789",
      bankCode: "058",
      status: "active"
    });
    mocks.findPaymentById.mockResolvedValue({ id: event.paymentId, invoiceId: "invoice-1" });
    mocks.markCompleted.mockResolvedValue({ id: event.settlementId });
    mocks.markSubmitted.mockResolvedValue({ id: event.settlementId });
    mocks.markProviderFailed.mockResolvedValue({ id: event.settlementId });
    mocks.submittedSettlements.mockResolvedValue([]);
  });

  it("queries the stable provider reference before retrying a transfer", async () => {
    const payout = {
      lookup: vi.fn().mockResolvedValue({
        accepted: true,
        conclusive: true,
        providerReference: event.settlementId,
        providerStatus: "success"
      }),
      transfer: vi.fn()
    };
    await new SettlementService(payout).handleQuoteLocked(event);
    expect(payout.lookup).toHaveBeenCalledWith(event.settlementId);
    expect(payout.transfer).not.toHaveBeenCalled();
    expect(mocks.markCompleted).toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "SettlementCompleted" }), {});
  });

  it("uses the settlement id as the idempotency key when no prior payout exists", async () => {
    const payout = {
      lookup: vi.fn().mockResolvedValue(null),
      transfer: vi.fn().mockResolvedValue({
        accepted: true,
        conclusive: true,
        providerReference: "provider-1",
        providerStatus: "success"
      })
    };
    await new SettlementService(payout).handleQuoteLocked(event);
    expect(payout.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: event.settlementId, reason: "TRF" })
    );
  });

  it("does not complete a payout the provider reports as failed", async () => {
    const payout = {
      lookup: vi.fn().mockResolvedValue({
        accepted: false,
        conclusive: true,
        providerReference: "provider-failed",
        providerStatus: "failed"
      }),
      transfer: vi.fn()
    };

    await new SettlementService(payout).handleQuoteLocked(event);

    expect(payout.transfer).not.toHaveBeenCalled();
    expect(mocks.markCompleted).not.toHaveBeenCalled();
    expect(mocks.markProviderFailed).toHaveBeenCalled();
  });

  it("keeps a pending Paystack transfer submitted", async () => {
    const payout = {
      lookup: vi.fn().mockResolvedValue(null),
      transfer: vi.fn().mockResolvedValue({
        accepted: false,
        conclusive: false,
        providerReference: "provider-pending",
        providerStatus: "pending"
      })
    };

    await new SettlementService(payout).handleQuoteLocked(event);

    expect(mocks.markSubmitted).toHaveBeenCalledWith(
      event.settlementId,
      "provider-pending",
      "pending"
    );
    expect(mocks.markCompleted).not.toHaveBeenCalled();
  });
});
