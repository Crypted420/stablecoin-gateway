export type Token = "USDT" | "USDC" | "cNGN";
export type Network = "polygon" | "bsc";

export interface Bank {
  name: string;
  code: string;
  slug: string;
}

export interface Merchant {
  id: string;
  accountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankCode: string;
  accountVerified: boolean;
  status: string;
}

export interface Invoice {
  id: string;
  reference: string;
  amountExpected: string;
  tokenSymbol: Token;
  network: Network;
  depositAddress: string;
  status: "pending" | "detected" | "confirmed" | "settled" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  txHash: string;
  amountRaw: string;
  confirmations: number;
  status: string;
  detectedAt: string;
  confirmedAt: string | null;
}

export interface Settlement {
  id: string;
  amountNgn: string;
  quoteRate: string | null;
  valuationBasis: "market" | "par";
  providerReference: string | null;
  providerStatus: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  reference?: string;
  tokenSymbol?: string;
  network?: string;
  txHash?: string;
}

export interface AdminOverview {
  merchants: number;
  invoices: number;
  confirmedWallets: number;
  awaitingPayoutApproval: number;
  sweepable: number;
  swept: number;
  failedSweeps: number;
  treasuryAddress: string | null;
  treasuryConfigured: boolean;
  gasWalletConfigured: boolean;
}

export interface SweepCandidate {
  paymentId: string;
  invoiceId: string;
  merchantId: string;
  merchantName: string;
  reference: string;
  network: Network;
  tokenSymbol: Token;
  depositAddress: string;
  derivationIndex: number;
  depositedAmountRaw: string;
  confirmedAt: string | null;
  sweepId: string | null;
  sweepStatus: string;
  tokenBalanceRaw: string | null;
  nativeBalanceRaw: string | null;
  requiredGasRaw: string | null;
  lastError: string | null;
  completedAt: string | null;
  fundingTxHash: string | null;
  sweepTxHash: string | null;
}

export interface AdminPayout extends Settlement {
  merchantName: string;
  bankAccountNumber: string;
  bankName: string;
  reference: string;
  tokenSymbol: Token;
  network: Network;
  txHash: string;
  amountRaw: string;
}

export interface Reconciliation {
  onChainTotalNgn: string;
  ledgerDebitTotal: string;
  ledgerCreditTotal: string;
  payoutTotalNgn: string;
  outstandingPayoutNgn: string;
  balanced: boolean;
}
