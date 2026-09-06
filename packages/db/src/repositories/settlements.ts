import type { Settlement, SettlementStatus } from "@gateway/core";
import { db, isUniqueViolation, type Executor } from "../pool.js";

interface Row {
  id: string;
  payment_id: string;
  quote_rate: string | null;
  quote_locked_at: Date | null;
  valuation_basis: "market" | "par";
  amount_ngn: string;
  provider_reference: string | null;
  provider_status: string | null;
  status: string;
  attempts: number;
  submitted_at: Date | null;
  last_error: string | null;
  completed_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  approval_note: string | null;
  created_at: Date;
}

const toSettlement = (r: Row): Settlement => ({
  id: r.id,
  paymentId: r.payment_id,
  quoteRate: r.quote_rate,
  quoteLockedAt: r.quote_locked_at ? r.quote_locked_at.toISOString() : null,
  valuationBasis: r.valuation_basis,
  amountNgn: r.amount_ngn,
  providerReference: r.provider_reference,
  providerStatus: r.provider_status,
  status: r.status as SettlementStatus,
  attempts: r.attempts,
  submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
  lastError: r.last_error,
  completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
  approvalNote: r.approval_note,
  createdAt: r.created_at.toISOString()
});

export async function insertSettlementIfNew(
  input: {
    paymentId: string;
    quoteRate: string;
    amountNgn: string;
    valuationBasis: "market" | "par";
  },
  x: Executor = db()
): Promise<Settlement | null> {
  try {
    const { rows } = await x.query<Row>(
      `INSERT INTO settlements (payment_id, quote_rate, quote_locked_at, amount_ngn, valuation_basis)
       VALUES ($1, $2::numeric, now(), $3, $4)
       ON CONFLICT (payment_id) DO NOTHING
       RETURNING *`,
      [input.paymentId, input.quoteRate, input.amountNgn, input.valuationBasis]
    );
    return rows[0] ? toSettlement(rows[0]) : null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

export async function findSettlementById(id: string, x: Executor = db()): Promise<Settlement | null> {
  const { rows } = await x.query<Row>("SELECT * FROM settlements WHERE id = $1", [id]);
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function findSettlementByPayment(
  paymentId: string,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>("SELECT * FROM settlements WHERE payment_id = $1", [paymentId]);
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function holdForApproval(id: string, x: Executor = db()): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'awaiting_approval', last_error = NULL
      WHERE id = $1 AND status IN ('pending','failed')
      RETURNING *`,
    [id]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function approve(
  id: string,
  approvedBy: string,
  note: string | null,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET approved_by = $2, approved_at = now(), approval_note = $3
      WHERE id = $1 AND status = 'awaiting_approval'
      RETURNING *`,
    [id, approvedBy, note]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function reject(
  id: string,
  rejectedBy: string,
  note: string | null,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'rejected', approved_by = $2, approved_at = now(), approval_note = $3
      WHERE id = $1 AND status = 'awaiting_approval'
      RETURNING *`,
    [id, rejectedBy, note]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function awaitingApproval(x: Executor = db()): Promise<Settlement[]> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM settlements WHERE status = 'awaiting_approval' ORDER BY created_at"
  );
  return rows.map(toSettlement);
}

export interface ActionablePayout extends Settlement {
  merchantName: string;
  bankAccountNumber: string;
  bankName: string;
  reference: string;
  tokenSymbol: string;
  network: string;
  txHash: string;
  amountRaw: string;
}

export async function actionablePayouts(x: Executor = db()): Promise<ActionablePayout[]> {
  const { rows } = await x.query<
    Row & {
      merchant_name: string;
      bank_account_number: string;
      bank_name: string;
      reference: string;
      token_symbol: string;
      network: string;
      tx_hash: string;
      amount_raw: string;
    }
  >(
    `SELECT s.*, m.account_name AS merchant_name, m.bank_account_number, m.bank_name,
            i.reference, i.token_symbol, i.network, p.tx_hash, p.amount_raw::text
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       JOIN invoices i ON i.id = p.invoice_id
       JOIN merchants m ON m.id = i.merchant_id
      WHERE s.status IN ('submitted','failed')
      ORDER BY s.created_at`
  );
  return rows.map((row) => ({
    ...toSettlement(row),
    merchantName: row.merchant_name,
    bankAccountNumber: row.bank_account_number,
    bankName: row.bank_name,
    reference: row.reference,
    tokenSymbol: row.token_symbol,
    network: row.network,
    txHash: row.tx_hash,
    amountRaw: row.amount_raw
  }));
}

export async function beginAttempt(id: string, x: Executor = db()): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'submitted', attempts = attempts + 1, submitted_at = now(), last_error = NULL
      WHERE id = $1 AND status IN ('pending','failed','awaiting_approval')
      RETURNING *`,
    [id]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function markSubmitted(
  id: string,
  providerReference: string,
  providerStatus: string | null,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'submitted', provider_reference = $2, provider_status = $3, last_error = NULL
      WHERE id = $1 AND status = 'submitted'
      RETURNING *`,
    [id, providerReference, providerStatus]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function submittedSettlements(limit = 50, x: Executor = db()): Promise<Settlement[]> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM settlements WHERE status = 'submitted' ORDER BY submitted_at NULLS FIRST LIMIT $1",
    [limit]
  );
  return rows.map(toSettlement);
}

export async function markProviderFailed(
  id: string,
  providerReference: string,
  providerStatus: string,
  error: string,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'failed', provider_reference = $2, provider_status = $3, last_error = $4
      WHERE id = $1 AND status = 'submitted'
      RETURNING *`,
    [id, providerReference, providerStatus, error]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function markCompleted(
  id: string,
  providerReference: string,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    `UPDATE settlements
        SET status = 'completed', provider_reference = $2, provider_status = 'success',
            completed_at = now(), last_error = NULL
      WHERE id = $1 AND status = 'submitted'
      RETURNING *`,
    [id, providerReference]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function markFailed(
  id: string,
  error: string,
  deadLetter: boolean,
  x: Executor = db()
): Promise<Settlement | null> {
  const { rows } = await x.query<Row>(
    "UPDATE settlements SET status = $3, last_error = $2 WHERE id = $1 RETURNING *",
    [id, error, deadLetter ? "dead_lettered" : "failed"]
  );
  return rows[0] ? toSettlement(rows[0]) : null;
}

export async function listSettlements(
  merchantId: string,
  limit = 100,
  x: Executor = db()
): Promise<Array<Settlement & { reference: string; tokenSymbol: string; network: string; txHash: string }>> {
  const { rows } = await x.query<
    Row & { reference: string; token_symbol: string; network: string; tx_hash: string }
  >(
    `SELECT s.*, i.reference, i.token_symbol, i.network, p.tx_hash
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       JOIN invoices i ON i.id = p.invoice_id
      WHERE i.merchant_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [merchantId, limit]
  );
  return rows.map((r) => ({
    ...toSettlement(r),
    reference: r.reference,
    tokenSymbol: r.token_symbol,
    network: r.network,
    txHash: r.tx_hash
  }));
}

export async function settlementsInPeriod(
  merchantId: string,
  from: Date,
  to: Date,
  x: Executor = db()
): Promise<Array<Settlement & { reference: string; txHash: string }>> {
  const { rows } = await x.query<Row & { reference: string; tx_hash: string }>(
    `SELECT s.*, i.reference, p.tx_hash
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       JOIN invoices i ON i.id = p.invoice_id
      WHERE i.merchant_id = $1 AND s.created_at >= $2 AND s.created_at < $3
      ORDER BY s.created_at`,
    [merchantId, from, to]
  );
  return rows.map((r) => ({ ...toSettlement(r), reference: r.reference, txHash: r.tx_hash }));
}

export async function payoutTotalNgn(x: Executor = db()): Promise<string> {
  const { rows } = await x.query<{ total: string | null }>(
    "SELECT COALESCE(SUM(amount_ngn), 0)::text AS total FROM settlements WHERE status = 'completed'"
  );
  return rows[0]?.total ?? "0";
}

export async function retryableSettlements(x: Executor = db()): Promise<Settlement[]> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM settlements WHERE status IN ('pending','failed') ORDER BY created_at LIMIT 50"
  );
  return rows.map(toSettlement);
}
