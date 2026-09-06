export const TOKENS = ["USDT", "USDC", "cNGN"] as const;
export type Token = (typeof TOKENS)[number];

export const NETWORKS = ["polygon", "bsc"] as const;
export type Network = (typeof NETWORKS)[number];

export type InvoiceStatus =
  | "pending"
  | "detected"
  | "confirmed"
  | "settled"
  | "expired"
  | "underpaid"
  | "overpaid"
  | "orphaned";
export type PaymentStatus = "detected" | "confirmed" | "underpaid" | "overpaid" | "orphaned";
export type SettlementStatus =
  | "pending"
  | "awaiting_approval"
  | "submitted"
  | "completed"
  | "failed"
  | "rejected"
  | "dead_lettered";
export type LedgerDirection = "debit" | "credit";
export type MerchantStatus = "active" | "suspended";
export type WalletSweepStatus =
  | "pending"
  | "funding"
  | "funded"
  | "sweeping"
  | "completed"
  | "empty"
  | "failed";

export interface Merchant {
  id: string;
  accountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankCode: string;
  accountVerified: boolean;
  webhookUrl: string | null;
  status: MerchantStatus;
  createdAt: string;
}

export interface Invoice {
  id: string;
  merchantId: string;
  reference: string;
  amountExpected: string;
  tokenSymbol: Token;
  network: Network;
  depositAddress: string;
  derivationIndex: number;
  status: InvoiceStatus;
  expiresAt: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  amountRaw: string;
  network: Network;
  tokenSymbol: Token;
  blockNumber: number;
  blockHash: string | null;
  confirmations: number;
  status: PaymentStatus;
  detectedAt: string;
  confirmedAt: string | null;
}

export interface Settlement {
  id: string;
  paymentId: string;
  quoteRate: string | null;
  quoteLockedAt: string | null;
  valuationBasis: "market" | "par";
  amountNgn: string;
  providerReference: string | null;
  providerStatus: string | null;
  status: SettlementStatus;
  attempts: number;
  submittedAt: string | null;
  lastError: string | null;
  completedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  settlementId: string;
  account: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
  createdAt: string;
}

export interface WalletSweep {
  id: string;
  paymentId: string;
  invoiceId: string;
  network: Network;
  tokenSymbol: Token;
  depositAddress: string;
  derivationIndex: number;
  treasuryAddress: string;
  tokenBalanceRaw: string | null;
  nativeBalanceRaw: string | null;
  requiredGasRaw: string | null;
  status: WalletSweepStatus;
  attempts: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationReport {
  periodStart: string;
  periodEnd: string;
  onChainTotalNgn: string;
  ledgerDebitTotal: string;
  ledgerCreditTotal: string;
  payoutTotalNgn: string;
  outstandingPayoutNgn: string;
  balanced: boolean;
  discrepancies: string[];
  checkedPayments: number;
  checkedPayouts: number;
}
