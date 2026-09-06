import type { DurationMetrics, FlowRecord, MeasuredFlow } from "./types.js";

function difference(later: string | null, earlier: string | null): number | null {
  if (!later || !earlier) return null;
  return new Date(later).getTime() - new Date(earlier).getTime();
}

export function withDurations(flow: FlowRecord): MeasuredFlow {
  const durations: DurationMetrics = {
    submitToReceiptMs: difference(flow.receiptObservedAt, flow.transferSubmittedAt),
    submitToDetectionMs: difference(flow.paymentDetectedAt, flow.transferSubmittedAt),
    blockToDetectionMs: difference(flow.paymentDetectedAt, flow.blockMinedAt),
    detectionToConfirmationMs: difference(flow.paymentConfirmedAt, flow.paymentDetectedAt),
    confirmationToQuoteMs: difference(flow.quoteLockedAt, flow.paymentConfirmedAt),
    quoteToPayoutSubmissionMs: difference(flow.payoutSubmittedAt, flow.quoteLockedAt),
    payoutMs: difference(flow.completedAt, flow.payoutSubmittedAt),
    afterFinalityMs: difference(flow.completedAt, flow.paymentConfirmedAt),
    totalMs: difference(flow.completedAt, flow.transferSubmittedAt)
  };
  return { ...flow, durations };
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function distribution(values: Array<number | null>): { medianMs: number | null; p95Ms: number | null } {
  const present = values.filter((value): value is number => value !== null);
  return { medianMs: percentile(present, 0.5), p95Ms: percentile(present, 0.95) };
}

function peakConcurrency(flows: MeasuredFlow[]): number {
  const points = flows.flatMap((flow) => {
    if (!flow.transferSubmittedAt || !flow.completedAt) return [];
    return [
      { at: new Date(flow.transferSubmittedAt).getTime(), delta: 1 },
      { at: new Date(flow.completedAt).getTime(), delta: -1 }
    ];
  });
  points.sort((a, b) => a.at - b.at || b.delta - a.delta);
  let active = 0;
  let peak = 0;
  for (const point of points) {
    active += point.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

export function summarize(flows: FlowRecord[], configuredConcurrency: number): Record<string, unknown> {
  const measured = flows.filter((flow) => !flow.warmup).map(withDurations);
  const completed = measured.filter((flow) => flow.settlementStatus === "completed");
  const references = completed
    .map((flow) => flow.providerReference)
    .filter((value): value is string => Boolean(value));
  const duplicateReferences = references.filter((value, index) => references.indexOf(value) !== index);
  const missed = measured.filter((flow) => flow.txHash && !flow.paymentDetectedAt);
  const terminalSettlementStatuses = new Set(["completed", "failed", "rejected", "dead_lettered"]);
  const terminalPaymentStatuses = new Set(["underpaid", "overpaid", "orphaned"]);
  const nonTerminal = measured.filter(
    (flow) =>
      flow.txHash &&
      !terminalSettlementStatuses.has(flow.settlementStatus ?? "") &&
      !terminalPaymentStatuses.has(flow.paymentStatus ?? "")
  );
  const submittedTimes = measured
    .map((flow) => flow.transferSubmittedAt && new Date(flow.transferSubmittedAt).getTime())
    .filter((value): value is number => typeof value === "number");
  const terminalTimes = measured
    .map((flow) => flow.completedAt && new Date(flow.completedAt).getTime())
    .filter((value): value is number => typeof value === "number");
  const elapsedSeconds =
    submittedTimes.length && terminalTimes.length
      ? (Math.max(...terminalTimes) - Math.min(...submittedTimes)) / 1_000
      : 0;

  const totalLatency = distribution(measured.map((flow) => flow.durations.totalMs));
  const afterFinality = distribution(measured.map((flow) => flow.durations.afterFinalityMs));
  const achievedPeakConcurrency = peakConcurrency(measured);
  const byNetwork = Object.fromEntries(
    [...new Set(measured.map((flow) => flow.network))].map((network) => {
      const networkFlows = measured.filter((flow) => flow.network === network);
      return [
        network,
        {
          flows: networkFlows.length,
          completed: networkFlows.filter((flow) => flow.settlementStatus === "completed").length,
          gasSpentNativeRaw: networkFlows
            .reduce((total, flow) => total + BigInt(flow.gasCostNativeRaw ?? "0"), 0n)
            .toString(),
          totalLatency: distribution(networkFlows.map((flow) => flow.durations.totalMs)),
          afterFinality: distribution(networkFlows.map((flow) => flow.durations.afterFinalityMs))
        }
      ];
    })
  );
  return {
    flows: measured.length,
    completed: completed.length,
    successRatePercent: measured.length ? (completed.length / measured.length) * 100 : 0,
    configuredConcurrency,
    achievedPeakConcurrency,
    achievedThroughputPerSecond: elapsedSeconds > 0 ? completed.length / elapsedSeconds : 0,
    missedTransfers: missed.length,
    duplicateProviderReferences: [...new Set(duplicateReferences)],
    nonTerminalFlows: nonTerminal.map((flow) => flow.flowId),
    byNetwork,
    latency: {
      total: totalLatency,
      afterFinality,
      submitToDetection: distribution(measured.map((flow) => flow.durations.submitToDetectionMs)),
      detectionToConfirmation: distribution(measured.map((flow) => flow.durations.detectionToConfirmationMs)),
      confirmationToQuote: distribution(measured.map((flow) => flow.durations.confirmationToQuoteMs)),
      payout: distribution(measured.map((flow) => flow.durations.payoutMs))
    },
    nfr: {
      nfr01TotalMedianUnder60Seconds: totalLatency.medianMs !== null && totalLatency.medianMs < 60_000,
      nfr01AfterFinalityMedianUnder60Seconds:
        afterFinality.medianMs !== null && afterFinality.medianMs < 60_000,
      nfr02AtLeast50ConcurrentFlows: achievedPeakConcurrency >= 50,
      nfr03NoTransferMissed: missed.length === 0,
      nfr04NoDuplicateSettlement: duplicateReferences.length === 0,
      nfr05NoPaymentLeftNonTerminal: nonTerminal.length === 0
    }
  };
}
