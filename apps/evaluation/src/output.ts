import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowRecord } from "./types.js";
import { summarize, withDurations } from "./metrics.js";

function csv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function writeOutputs(
  directory: string,
  metadata: Record<string, unknown>,
  flows: FlowRecord[],
  reconciliation: unknown = null
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const measured = flows.map(withDurations);
  const summary = summarize(flows, Number(metadata.concurrency));
  await Promise.all([
    writeFile(join(directory, "flows.json"), JSON.stringify({ metadata, flows: measured }, null, 2)),
    writeFile(
      join(directory, "summary.json"),
      JSON.stringify({ metadata, summary, reconciliation }, null, 2)
    ),
    writeFile(join(directory, "flows.csv"), toCsv(measured))
  ]);
}

function toCsv(flows: ReturnType<typeof withDurations>[]): string {
  const headers = [
    "flow_id",
    "warmup",
    "network",
    "token",
    "amount",
    "invoice_id",
    "deposit_address",
    "tx_hash",
    "payment_amount_raw",
    "confirmations",
    "provider_reference",
    "quote_rate",
    "amount_ngn",
    "invoice_status",
    "payment_status",
    "settlement_status",
    "invoice_created_at",
    "transfer_submitted_at",
    "transfer_broadcast_at",
    "block_mined_at",
    "receipt_observed_at",
    "payment_detected_at",
    "payment_confirmed_at",
    "quote_locked_at",
    "payout_submitted_at",
    "completed_at",
    "submit_to_detection_ms",
    "detection_to_confirmation_ms",
    "confirmation_to_quote_ms",
    "after_finality_ms",
    "total_ms",
    "gas_used_raw",
    "gas_cost_native_raw",
    "error"
  ];
  const rows = flows.map((flow) =>
    [
      flow.flowId,
      flow.warmup,
      flow.network,
      flow.token,
      flow.amount,
      flow.invoiceId,
      flow.depositAddress,
      flow.txHash,
      flow.paymentAmountRaw,
      flow.confirmations,
      flow.providerReference,
      flow.quoteRate,
      flow.amountNgn,
      flow.invoiceStatus,
      flow.paymentStatus,
      flow.settlementStatus,
      flow.invoiceCreatedAt,
      flow.transferSubmittedAt,
      flow.transferBroadcastAt,
      flow.blockMinedAt,
      flow.receiptObservedAt,
      flow.paymentDetectedAt,
      flow.paymentConfirmedAt,
      flow.quoteLockedAt,
      flow.payoutSubmittedAt,
      flow.completedAt,
      flow.durations.submitToDetectionMs,
      flow.durations.detectionToConfirmationMs,
      flow.durations.confirmationToQuoteMs,
      flow.durations.afterFinalityMs,
      flow.durations.totalMs,
      flow.gasUsedRaw,
      flow.gasCostNativeRaw,
      flow.error
    ]
      .map(csv)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}
