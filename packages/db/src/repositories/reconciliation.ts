import type { Network, ReconciliationReport, SettlementStatus, Token } from "@gateway/core";
import { db, type Executor } from "../pool.js";

export interface ReconciliationItem {
  settlementId: string;
  paymentId: string;
  amountNgn: string;
  status: SettlementStatus;
  providerReference: string | null;
  providerStatus: string | null;
  network: Network;
  tokenSymbol: Token;
  blockNumber: number;
  blockHash: string | null;
}

export async function itemsInPeriod(
  periodStart: Date,
  periodEnd: Date,
  x: Executor = db()
): Promise<ReconciliationItem[]> {
  const { rows } = await x.query<{
    settlement_id: string;
    payment_id: string;
    amount_ngn: string;
    status: SettlementStatus;
    provider_reference: string | null;
    provider_status: string | null;
    network: Network;
    token_symbol: Token;
    block_number: number;
    block_hash: string | null;
  }>(
    `SELECT s.id AS settlement_id, s.payment_id, s.amount_ngn, s.status, s.provider_reference, s.provider_status,
            p.network, p.token_symbol, p.block_number, p.block_hash
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
      WHERE s.created_at >= $1 AND s.created_at < $2
      ORDER BY s.created_at`,
    [periodStart, periodEnd]
  );
  return rows.map((row) => ({
    settlementId: row.settlement_id,
    paymentId: row.payment_id,
    amountNgn: row.amount_ngn,
    status: row.status,
    providerReference: row.provider_reference,
    providerStatus: row.provider_status,
    network: row.network,
    tokenSymbol: row.token_symbol,
    blockNumber: row.block_number,
    blockHash: row.block_hash
  }));
}

export async function save(report: ReconciliationReport, x: Executor = db()): Promise<void> {
  await x.query(
    `INSERT INTO reconciliation_reports (period_start, period_end, report, balanced)
     VALUES ($1,$2,$3::jsonb,$4)`,
    [report.periodStart, report.periodEnd, JSON.stringify(report), report.balanced]
  );
}

export async function latest(x: Executor = db()): Promise<ReconciliationReport | null> {
  const { rows } = await x.query<{ report: ReconciliationReport }>(
    "SELECT report FROM reconciliation_reports ORDER BY created_at DESC LIMIT 1"
  );
  return rows[0]?.report ?? null;
}
