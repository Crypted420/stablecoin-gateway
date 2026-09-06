import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBroker } from "@gateway/broker";
import {
  newEnvelope,
  paymentKey,
  type PaymentDetected,
  type QuoteLocked
} from "@gateway/core";
import { PayoutTimeoutError } from "@gateway/providers";

const mocks = vi.hoisted(() => ({
  insertPaymentIfNew: vi.fn(),
  paymentsAwaitingConfirmation: vi.fn(),
  transitionDetectedPayment: vi.fn(),
  setPaymentStatus: vi.fn(),
  findPaymentById: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  findInvoiceById: vi.fn(),
  enqueue: vi.fn(),
  beginAttempt: vi.fn(),
  markSubmitted: vi.fn(),
  markProviderFailed: vi.fn(),
  submittedSettlements: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  findSettlementById: vi.fn(),
  findMerchantById: vi.fn()
}));

vi.mock("@gateway/db", () => ({
  payments: {
    insertPaymentIfNew: mocks.insertPaymentIfNew,
    paymentsAwaitingConfirmation: mocks.paymentsAwaitingConfirmation,
    transitionDetectedPayment: mocks.transitionDetectedPayment,
    setPaymentStatus: mocks.setPaymentStatus,
    findPaymentById: mocks.findPaymentById
  },
  invoices: {
    updateInvoiceStatus: mocks.updateInvoiceStatus,
    findInvoiceById: mocks.findInvoiceById
  },
  outbox: { enqueue: mocks.enqueue },
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
  withTransaction: async (operation: (client: object) => Promise<unknown>) => operation({})
}));

import { ConfirmationService } from "./services/confirmation.js";
import { SettlementService } from "./services/settlement.js";

function detectedEvent(): PaymentDetected {
  return {
    ...newEnvelope(),
    name: "PaymentDetected",
    invoiceId: crypto.randomUUID(),
    txHash: "0xabc123",
    logIndex: 0,
    fromAddress: "0x0000000000000000000000000000000000000001",
    toAddress: "0x0000000000000000000000000000000000000002",
    amountRaw: "100000",
    tokenSymbol: "USDT",
    network: "polygon",
    blockNumber: 100,
    blockHash: "0xcanonical"
  };
}

const quoteEvent: QuoteLocked = {
  ...newEnvelope(),
  name: "QuoteLocked",
  settlementId: "11111111-1111-4111-8111-111111111111",
  paymentId: "22222222-2222-4222-8222-222222222222",
  merchantId: "33333333-3333-4333-8333-333333333333",
  rate: "1355.31000000",
  amountNgn: "135.53"
};

describe("final-evaluation failure injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMerchantById.mockResolvedValue({
      id: quoteEvent.merchantId,
      bankAccountNumber: "0123456789",
      bankCode: "058",
      status: "active"
    });
    mocks.findPaymentById.mockResolvedValue({ id: quoteEvent.paymentId, invoiceId: "invoice-1" });
    mocks.findInvoiceById.mockResolvedValue({ id: "invoice-1", merchantId: quoteEvent.merchantId });
    mocks.markCompleted.mockResolvedValue({ id: quoteEvent.settlementId });
    mocks.markSubmitted.mockResolvedValue({ id: quoteEvent.settlementId });
    mocks.markProviderFailed.mockResolvedValue({ id: quoteEvent.settlementId });
    mocks.beginAttempt.mockResolvedValue({ id: quoteEvent.settlementId, attempts: 1 });
    mocks.submittedSettlements.mockResolvedValue([]);
  });

  it("[consumer-killed-mid-processing] reclaims an unacknowledged event without duplicating its committed effect", async () => {
    const broker = new MemoryBroker();
    const event = detectedEvent();
    await broker.publish(event);
    const [delivery] = await broker.read("confirmation", "consumer-before-kill", 1, 0);
    expect(delivery).toBeDefined();

    const committed = new Set<string>();
    let writes = 0;
    const apply = (candidate: PaymentDetected) => {
      const key = paymentKey(candidate.txHash, candidate.logIndex);
      if (committed.has(key)) return;
      committed.add(key);
      writes += 1;
    };

    apply(delivery!.event as PaymentDetected);
    // Simulated termination point: the business write committed, but no ACK was sent.
    expect(await broker.pendingCount("confirmation")).toBe(1);

    const [reclaimed] = await broker.reclaim("confirmation", "consumer-after-restart", 0, 1);
    expect(reclaimed).toBeDefined();
    apply(reclaimed!.event as PaymentDetected);
    await broker.ack("confirmation", reclaimed!.id);

    expect(writes).toBe(1);
    expect(await broker.pendingCount("confirmation")).toBe(0);
  });

  it("[replayed-event] persists one payment when the same transfer event is delivered repeatedly", async () => {
    const event = detectedEvent();
    const persisted = new Set<string>();
    mocks.insertPaymentIfNew.mockImplementation(async (input: { txHash: string; logIndex: number }) => {
      const key = paymentKey(input.txHash, input.logIndex);
      if (persisted.has(key)) return null;
      persisted.add(key);
      return { id: crypto.randomUUID() };
    });
    const source = {} as ConstructorParameters<typeof ConfirmationService>[0];
    const confirmation = new ConfirmationService(source);

    await confirmation.handleDetected(event);
    await confirmation.handleDetected(event);
    await confirmation.handleDetected(event);

    expect(mocks.insertPaymentIfNew).toHaveBeenCalledTimes(3);
    expect(persisted.size).toBe(1);
  });

  it("[reorg] marks a sufficiently deep but non-canonical payment orphaned before conversion", async () => {
    const payment = {
      id: quoteEvent.paymentId,
      invoiceId: crypto.randomUUID(),
      merchantId: quoteEvent.merchantId,
      txHash: "0xreorged",
      logIndex: 0,
      fromAddress: "0x0000000000000000000000000000000000000001",
      amountRaw: "100000",
      amountExpected: "0.10000000",
      network: "polygon" as const,
      tokenSymbol: "USDT" as const,
      blockNumber: 100,
      blockHash: "0xorphaned",
      confirmations: 0,
      status: "detected" as const,
      detectedAt: new Date().toISOString(),
      confirmedAt: null
    };
    mocks.paymentsAwaitingConfirmation.mockResolvedValue([payment]);
    mocks.transitionDetectedPayment.mockResolvedValue({ ...payment, status: "orphaned" });
    const source = {
      confirmationsFor: vi.fn().mockResolvedValue(60),
      isCanonical: vi.fn().mockResolvedValue(false)
    } as unknown as ConstructorParameters<typeof ConfirmationService>[0];

    const promoted = await new ConfirmationService(source).sweep();

    expect(promoted).toBe(0);
    expect(mocks.transitionDetectedPayment).toHaveBeenCalledWith(payment.id, "orphaned", 60, {});
    expect(mocks.updateInvoiceStatus).toHaveBeenCalledWith(payment.invoiceId, "orphaned", {});
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PaymentRejected", reason: "orphaned" }),
      {}
    );
    expect(mocks.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "PaymentConfirmed" }),
      expect.anything()
    );
  });

  it("[payout-timeout] keeps an unknown transfer resumable and completes it by idempotent lookup", async () => {
    const payout = {
      lookup: vi.fn().mockResolvedValue(null),
      transfer: vi.fn().mockRejectedValue(new PayoutTimeoutError(quoteEvent.settlementId))
    };
    const settlement = new SettlementService(payout);

    await settlement.handleQuoteLocked(quoteEvent);

    expect(mocks.markSubmitted).toHaveBeenCalledWith(
      quoteEvent.settlementId,
      quoteEvent.settlementId,
      "unknown"
    );
    expect(mocks.markFailed).not.toHaveBeenCalled();

    mocks.submittedSettlements.mockResolvedValue([
      {
        id: quoteEvent.settlementId,
        paymentId: quoteEvent.paymentId,
        amountNgn: quoteEvent.amountNgn,
        status: "submitted",
        attempts: 1
      }
    ]);
    payout.lookup.mockResolvedValue({
      accepted: true,
      conclusive: true,
      providerReference: quoteEvent.settlementId,
      providerStatus: "success"
    });

    await expect(settlement.reconcileSubmitted()).resolves.toBe(1);
    expect(mocks.markCompleted).toHaveBeenCalledWith(quoteEvent.settlementId, quoteEvent.settlementId, {});
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "SettlementCompleted", settlementId: quoteEvent.settlementId }),
      {}
    );
  });
});
