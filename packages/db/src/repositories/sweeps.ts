import type {
  Network,
  Token,
  WalletSweep,
  WalletSweepStatus
} from "@gateway/core";
import { db, type Executor } from "../pool.js";

interface SweepRow {
  id: string;
  payment_id: string;
  invoice_id: string;
  network: string;
  token_symbol: string;
  deposit_address: string;
  derivation_index: number;
  treasury_address: string;
  token_balance_raw: string | null;
  native_balance_raw: string | null;
  required_gas_raw: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CandidateRow {
  payment_id: string;
  invoice_id: string;
  merchant_id: string;
  merchant_name: string;
  reference: string;
  network: string;
  token_symbol: string;
  deposit_address: string;
  derivation_index: number;
  amount_raw: string;
  confirmed_at: Date | null;
  sweep_id: string | null;
  sweep_status: string | null;
  token_balance_raw: string | null;
  native_balance_raw: string | null;
  required_gas_raw: string | null;
  last_error: string | null;
  completed_at: Date | null;
  funding_tx_hash: string | null;
  sweep_tx_hash: string | null;
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
  sweepStatus: WalletSweepStatus | "not_started";
  tokenBalanceRaw: string | null;
  nativeBalanceRaw: string | null;
  requiredGasRaw: string | null;
  lastError: string | null;
  completedAt: string | null;
  fundingTxHash: string | null;
  sweepTxHash: string | null;
}

export interface SweepTransaction {
  id: string;
  sweepId: string;
  kind: "funding" | "sweep";
  txHash: string;
  rawTransaction: string;
  amountRaw: string;
  status: "prepared" | "submitted" | "confirmed" | "failed";
}

const candidateSelect = `
  SELECT p.id AS payment_id,
         i.id AS invoice_id,
         i.merchant_id,
         m.account_name AS merchant_name,
         i.reference,
         p.network,
         p.token_symbol,
         i.deposit_address,
         i.derivation_index,
         p.amount_raw,
         p.confirmed_at,
         ws.id AS sweep_id,
         ws.status AS sweep_status,
         ws.token_balance_raw::text,
         ws.native_balance_raw::text,
         ws.required_gas_raw::text,
         ws.last_error,
         ws.completed_at,
         funding.tx_hash AS funding_tx_hash,
         swept.tx_hash AS sweep_tx_hash
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN merchants m ON m.id = i.merchant_id
    LEFT JOIN wallet_sweeps ws ON ws.payment_id = p.id
    LEFT JOIN LATERAL (
      SELECT tx_hash FROM wallet_sweep_transactions
       WHERE sweep_id = ws.id AND kind = 'funding'
       ORDER BY created_at DESC LIMIT 1
    ) funding ON true
    LEFT JOIN LATERAL (
      SELECT tx_hash FROM wallet_sweep_transactions
       WHERE sweep_id = ws.id AND kind = 'sweep'
       ORDER BY created_at DESC LIMIT 1
    ) swept ON true
   WHERE p.status = 'confirmed'`;

const toSweep = (row: SweepRow): WalletSweep => ({
  id: row.id,
  paymentId: row.payment_id,
  invoiceId: row.invoice_id,
  network: row.network as Network,
  tokenSymbol: row.token_symbol as Token,
  depositAddress: row.deposit_address,
  derivationIndex: row.derivation_index,
  treasuryAddress: row.treasury_address,
  tokenBalanceRaw: row.token_balance_raw,
  nativeBalanceRaw: row.native_balance_raw,
  requiredGasRaw: row.required_gas_raw,
  status: row.status as WalletSweepStatus,
  attempts: row.attempts,
  lastError: row.last_error,
  completedAt: row.completed_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString()
});

const toCandidate = (row: CandidateRow): SweepCandidate => ({
  paymentId: row.payment_id,
  invoiceId: row.invoice_id,
  merchantId: row.merchant_id,
  merchantName: row.merchant_name,
  reference: row.reference,
  network: row.network as Network,
  tokenSymbol: row.token_symbol as Token,
  depositAddress: row.deposit_address,
  derivationIndex: row.derivation_index,
  depositedAmountRaw: row.amount_raw,
  confirmedAt: row.confirmed_at?.toISOString() ?? null,
  sweepId: row.sweep_id,
  sweepStatus: (row.sweep_status as WalletSweepStatus | null) ?? "not_started",
  tokenBalanceRaw: row.token_balance_raw,
  nativeBalanceRaw: row.native_balance_raw,
  requiredGasRaw: row.required_gas_raw,
  lastError: row.last_error,
  completedAt: row.completed_at?.toISOString() ?? null,
  fundingTxHash: row.funding_tx_hash,
  sweepTxHash: row.sweep_tx_hash
});

export async function listCandidates(limit = 100, x: Executor = db()): Promise<SweepCandidate[]> {
  const { rows } = await x.query<CandidateRow>(
    `${candidateSelect} ORDER BY p.confirmed_at DESC NULLS LAST LIMIT $1`,
    [limit]
  );
  return rows.map(toCandidate);
}

export async function findCandidate(
  paymentId: string,
  x: Executor = db()
): Promise<SweepCandidate | null> {
  const { rows } = await x.query<CandidateRow>(`${candidateSelect} AND p.id = $1`, [paymentId]);
  return rows[0] ? toCandidate(rows[0]) : null;
}

export async function eligiblePaymentIds(limit: number, x: Executor = db()): Promise<string[]> {
  const { rows } = await x.query<{ id: string }>(
    `SELECT p.id
       FROM payments p
       LEFT JOIN wallet_sweeps ws ON ws.payment_id = p.id
      WHERE p.status = 'confirmed'
        AND (ws.id IS NULL OR ws.status NOT IN ('completed','empty'))
      ORDER BY p.confirmed_at
      LIMIT $1`,
    [limit]
  );
  return rows.map((row) => row.id);
}

export async function ensureJob(
  paymentId: string,
  treasuryAddress: string,
  x: Executor = db()
): Promise<WalletSweep | null> {
  const { rows } = await x.query<SweepRow>(
    `INSERT INTO wallet_sweeps
       (payment_id, invoice_id, network, token_symbol, deposit_address, derivation_index, treasury_address)
     SELECT p.id, i.id, p.network, p.token_symbol, i.deposit_address, i.derivation_index, $2
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE p.id = $1 AND p.status = 'confirmed'
     ON CONFLICT (payment_id) DO UPDATE
       SET treasury_address = wallet_sweeps.treasury_address
     RETURNING *`,
    [paymentId, treasuryAddress]
  );
  return rows[0] ? toSweep(rows[0]) : null;
}

export async function findByPaymentId(
  paymentId: string,
  x: Executor = db()
): Promise<WalletSweep | null> {
  const { rows } = await x.query<SweepRow>("SELECT * FROM wallet_sweeps WHERE payment_id = $1", [paymentId]);
  return rows[0] ? toSweep(rows[0]) : null;
}

export async function recordInspection(
  id: string,
  inspection: { tokenBalanceRaw: string; nativeBalanceRaw: string; requiredGasRaw: string },
  x: Executor = db()
): Promise<WalletSweep> {
  const { rows } = await x.query<SweepRow>(
    `UPDATE wallet_sweeps
        SET token_balance_raw = $2,
            native_balance_raw = $3,
            required_gas_raw = $4,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, inspection.tokenBalanceRaw, inspection.nativeBalanceRaw, inspection.requiredGasRaw]
  );
  return toSweep(rows[0]!);
}

export async function setStatus(
  id: string,
  status: WalletSweepStatus,
  error: string | null = null,
  x: Executor = db()
): Promise<WalletSweep> {
  const { rows } = await x.query<SweepRow>(
    `UPDATE wallet_sweeps
        SET status = $2::varchar(20),
            last_error = $3,
            attempts = CASE WHEN $2::varchar(20) IN ('funding','sweeping') THEN attempts + 1 ELSE attempts END,
            completed_at = CASE WHEN $2::varchar(20) IN ('completed','empty') THEN now() ELSE completed_at END,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, status, error]
  );
  return toSweep(rows[0]!);
}

export async function openTransaction(
  sweepId: string,
  kind: "funding" | "sweep",
  x: Executor = db()
): Promise<SweepTransaction | null> {
  const { rows } = await x.query<{
    id: string;
    sweep_id: string;
    kind: "funding" | "sweep";
    tx_hash: string;
    raw_transaction: string;
    amount_raw: string;
    status: SweepTransaction["status"];
  }>(
    `SELECT id, sweep_id, kind, tx_hash, raw_transaction, amount_raw::text, status
       FROM wallet_sweep_transactions
      WHERE sweep_id = $1 AND kind = $2 AND status IN ('prepared','submitted')
      ORDER BY created_at DESC LIMIT 1`,
    [sweepId, kind]
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        sweepId: row.sweep_id,
        kind: row.kind,
        txHash: row.tx_hash,
        rawTransaction: row.raw_transaction,
        amountRaw: row.amount_raw,
        status: row.status
      }
    : null;
}

export async function savePreparedTransaction(
  sweepId: string,
  kind: "funding" | "sweep",
  transaction: { hash: string; rawTransaction: string; amountRaw: string },
  x: Executor = db()
): Promise<SweepTransaction> {
  const { rows } = await x.query<{
    id: string;
    sweep_id: string;
    kind: "funding" | "sweep";
    tx_hash: string;
    raw_transaction: string;
    amount_raw: string;
    status: SweepTransaction["status"];
  }>(
    `INSERT INTO wallet_sweep_transactions
       (sweep_id, kind, tx_hash, raw_transaction, amount_raw)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tx_hash) DO UPDATE SET tx_hash = EXCLUDED.tx_hash
     RETURNING id, sweep_id, kind, tx_hash, raw_transaction, amount_raw::text, status`,
    [sweepId, kind, transaction.hash, transaction.rawTransaction, transaction.amountRaw]
  );
  const row = rows[0]!;
  return {
    id: row.id,
    sweepId: row.sweep_id,
    kind: row.kind,
    txHash: row.tx_hash,
    rawTransaction: row.raw_transaction,
    amountRaw: row.amount_raw,
    status: row.status
  };
}

export async function setTransactionStatus(
  id: string,
  status: SweepTransaction["status"],
  error: string | null = null,
  x: Executor = db()
): Promise<void> {
  await x.query(
    `UPDATE wallet_sweep_transactions
        SET status = $2::varchar(20),
            last_error = $3,
            submitted_at = CASE WHEN $2::varchar(20) = 'submitted' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
            confirmed_at = CASE WHEN $2::varchar(20) = 'confirmed' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END
      WHERE id = $1`,
    [id, status, error]
  );
}

export async function overview(x: Executor = db()): Promise<{
  merchants: number;
  invoices: number;
  confirmedWallets: number;
  awaitingPayoutApproval: number;
  sweepable: number;
  swept: number;
  failedSweeps: number;
}> {
  const { rows } = await x.query<Record<string, number>>(
    `SELECT
      (SELECT count(*)::int FROM merchants) AS merchants,
      (SELECT count(*)::int FROM invoices) AS invoices,
      (SELECT count(*)::int FROM payments WHERE status = 'confirmed') AS confirmed_wallets,
      (SELECT count(*)::int FROM settlements WHERE status = 'awaiting_approval') AS awaiting_payout_approval,
      (SELECT count(*)::int FROM payments p LEFT JOIN wallet_sweeps ws ON ws.payment_id = p.id
        WHERE p.status = 'confirmed' AND (ws.id IS NULL OR ws.status NOT IN ('completed','empty'))) AS sweepable,
      (SELECT count(*)::int FROM wallet_sweeps WHERE status = 'completed') AS swept,
      (SELECT count(*)::int FROM wallet_sweeps WHERE status = 'failed') AS failed_sweeps`
  );
  const row = rows[0] ?? {};
  return {
    merchants: row.merchants ?? 0,
    invoices: row.invoices ?? 0,
    confirmedWallets: row.confirmed_wallets ?? 0,
    awaitingPayoutApproval: row.awaiting_payout_approval ?? 0,
    sweepable: row.sweepable ?? 0,
    swept: row.swept ?? 0,
    failedSweeps: row.failed_sweeps ?? 0
  };
}
