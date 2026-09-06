import { describe, expect, it } from "vitest";
import { percentile, summarize, withDurations } from "./metrics.js";
import type { FlowRecord } from "./types.js";

function flow(overrides: Partial<FlowRecord> = {}): FlowRecord {
  return {
    flowId: "flow-1",
    warmup: false,
    network: "bsc",
    token: "USDT",
    amount: "1",
    invoiceId: "invoice-1",
    reference: "EVAL-1",
    depositAddress: "0x1",
    senderAddress: "0x2",
    txHash: "0xtx",
    paymentId: "payment-1",
    paymentAmountRaw: "1000000000000000000",
    confirmations: 15,
    settlementId: "settlement-1",
    providerReference: "provider-1",
    providerStatus: "success",
    quoteRate: "1356.30000000",
    amountNgn: "1356.30",
    invoiceStatus: "settled",
    paymentStatus: "confirmed",
    settlementStatus: "completed",
    invoiceCreatedAt: "2026-01-01T00:00:00.000Z",
    transferSubmittedAt: "2026-01-01T00:00:01.000Z",
    transferBroadcastAt: "2026-01-01T00:00:02.000Z",
    blockMinedAt: "2026-01-01T00:00:03.000Z",
    receiptObservedAt: "2026-01-01T00:00:04.000Z",
    paymentDetectedAt: "2026-01-01T00:00:05.000Z",
    paymentConfirmedAt: "2026-01-01T00:00:10.000Z",
    quoteLockedAt: "2026-01-01T00:00:11.000Z",
    payoutSubmittedAt: "2026-01-01T00:00:12.000Z",
    completedAt: "2026-01-01T00:00:13.000Z",
    gasUsedRaw: "50000",
    gasCostNativeRaw: "100000",
    error: null,
    ...overrides
  };
}

describe("evaluation metrics", () => {
  it("calculates pipeline durations from raw timestamps", () => {
    const measured = withDurations(flow());
    expect(measured.durations.submitToDetectionMs).toBe(4_000);
    expect(measured.durations.detectionToConfirmationMs).toBe(5_000);
    expect(measured.durations.afterFinalityMs).toBe(3_000);
    expect(measured.durations.totalMs).toBe(12_000);
  });

  it("interpolates percentiles without hiding the raw flows", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([], 0.95)).toBeNull();
  });

  it("excludes warmups and flags duplicate provider references", () => {
    const report = summarize(
      [flow({ warmup: true }), flow(), flow({ flowId: "flow-2" })],
      50
    ) as {
      flows: number;
      duplicateProviderReferences: string[];
      nfr: Record<string, boolean>;
    };
    expect(report.flows).toBe(2);
    expect(report.duplicateProviderReferences).toEqual(["provider-1"]);
    expect(report.nfr.nfr02AtLeast50ConcurrentFlows).toBe(false);
    expect(report.nfr.nfr04NoDuplicateSettlement).toBe(false);
  });

  it("counts a broadcast transaction with no detection as missed", () => {
    const report = summarize([flow({ paymentDetectedAt: null, settlementStatus: null })], 1) as {
      missedTransfers: number;
      nfr: Record<string, boolean>;
    };
    expect(report.missedTransfers).toBe(1);
    expect(report.nfr.nfr03NoTransferMissed).toBe(false);
    expect(report.nfr.nfr05NoPaymentLeftNonTerminal).toBe(false);
  });

  it("measures achieved overlapping flows rather than trusting the configured concurrency", () => {
    const report = summarize(
      [
        flow(),
        flow({
          flowId: "flow-2",
          providerReference: "provider-2",
          transferSubmittedAt: "2026-01-01T00:00:02.000Z",
          completedAt: "2026-01-01T00:00:14.000Z"
        })
      ],
      50
    ) as { achievedPeakConcurrency: number; nfr: Record<string, boolean> };
    expect(report.achievedPeakConcurrency).toBe(2);
    expect(report.nfr.nfr02AtLeast50ConcurrentFlows).toBe(false);
  });
});
