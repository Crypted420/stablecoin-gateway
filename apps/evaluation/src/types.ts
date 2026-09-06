import type { Invoice, Network, Payment, Settlement, Token } from "@gateway/core";

export interface EvaluationConfig {
  apiUrl: string;
  networks: Network[];
  token: Token;
  amount: string;
  measuredFlows: number;
  warmupFlows: number;
  repeats: number;
  concurrency: number;
  timeoutMs: number;
  pollIntervalMs: number;
  targetReadyMs: number;
  reconciliationDelayMs: number;
  payoutBalanceBufferBps: number;
  live: boolean;
  adminApiKey: string;
  paystackSecretKey: string;
  fxUrl: string;
  merchantId: string;
  merchantAccountNumber: string;
  merchantBankCode: string;
  outputDirectory: string;
  rpcUrls: Record<Network, string>;
  privateKeys: Record<Network, string>;
  confirmationDepths: Record<Network, number>;
}

export interface InvoiceDetail {
  invoice: Invoice;
  payment: Payment | null;
  settlement: Settlement | null;
}

export interface FlowRecord {
  flowId: string;
  warmup: boolean;
  network: Network;
  token: Token;
  amount: string;
  invoiceId: string | null;
  reference: string;
  depositAddress: string | null;
  senderAddress: string | null;
  txHash: string | null;
  paymentId: string | null;
  paymentAmountRaw: string | null;
  confirmations: number | null;
  settlementId: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  quoteRate: string | null;
  amountNgn: string | null;
  invoiceStatus: string | null;
  paymentStatus: string | null;
  settlementStatus: string | null;
  invoiceCreatedAt: string | null;
  transferSubmittedAt: string | null;
  transferBroadcastAt: string | null;
  blockMinedAt: string | null;
  receiptObservedAt: string | null;
  paymentDetectedAt: string | null;
  paymentConfirmedAt: string | null;
  quoteLockedAt: string | null;
  payoutSubmittedAt: string | null;
  completedAt: string | null;
  gasUsedRaw: string | null;
  gasCostNativeRaw: string | null;
  error: string | null;
}

export interface DurationMetrics {
  submitToReceiptMs: number | null;
  submitToDetectionMs: number | null;
  blockToDetectionMs: number | null;
  detectionToConfirmationMs: number | null;
  confirmationToQuoteMs: number | null;
  quoteToPayoutSubmissionMs: number | null;
  payoutMs: number | null;
  afterFinalityMs: number | null;
  totalMs: number | null;
}

export interface MeasuredFlow extends FlowRecord {
  durations: DurationMetrics;
}
