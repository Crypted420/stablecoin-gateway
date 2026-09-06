import type { Network, Payment, PaymentStatus, Token } from "@gateway/core";
import { db, isUniqueViolation, type Executor } from "../pool.js";

interface Row {
  id: string;
  invoice_id: string;
  tx_hash: string;
  log_index: number;
  from_address: string;
  amount_raw: string;
  network: string;
  token_symbol: string;
  block_number: number;
  block_hash: string | null;
  confirmations: number;
  status: string;
  detected_at: Date;
  confirmed_at: Date | null;
}

const toPayment = (r: Row): Payment => ({
  id: r.id,
  invoiceId: r.invoice_id,
  txHash: r.tx_hash,
  logIndex: r.log_index,
  fromAddress: r.from_address,
  amountRaw: r.amount_raw,
  network: r.network as Network,
  tokenSymbol: r.token_symbol as Token,
  blockNumber: r.block_number,
  blockHash: r.block_hash,
  confirmations: r.confirmations,
  status: r.status as PaymentStatus,
  detectedAt: r.detected_at.toISOString(),
  confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null
});

export async function insertPaymentIfNew(
  input: {
    invoiceId: string;
    txHash: string;
    logIndex: number;
    fromAddress: string;
    amountRaw: string;
    network: Network;
    tokenSymbol: Token;
    blockNumber: number;
    blockHash?: string | null;
  },
  x: Executor = db()
): Promise<Payment | null> {
  try {
    const { rows } = await x.query<Row>(
      `INSERT INTO payments
         (invoice_id, tx_hash, log_index, from_address, amount_raw, network, token_symbol, block_number, block_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (network, tx_hash, log_index) DO NOTHING
       RETURNING *`,
      [
        input.invoiceId,
        input.txHash.toLowerCase(),
        input.logIndex,
        input.fromAddress.toLowerCase(),
        input.amountRaw,
        input.network,
        input.tokenSymbol,
        input.blockNumber,
        input.blockHash ?? null
      ]
    );
    return rows[0] ? toPayment(rows[0]) : null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

export async function findPaymentById(id: string, x: Executor = db()): Promise<Payment | null> {
  const { rows } = await x.query<Row>("SELECT * FROM payments WHERE id = $1", [id]);
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function findPaymentByKey(
  network: Network,
  txHash: string,
  logIndex: number,
  x: Executor = db()
): Promise<Payment | null> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM payments WHERE network = $1 AND tx_hash = $2 AND log_index = $3",
    [network, txHash.toLowerCase(), logIndex]
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function findPaymentByInvoice(
  invoiceId: string,
  x: Executor = db()
): Promise<Payment | null> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM payments WHERE invoice_id = $1 ORDER BY detected_at LIMIT 1",
    [invoiceId]
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function setPaymentStatus(
  id: string,
  status: PaymentStatus,
  confirmations: number,
  x: Executor = db()
): Promise<Payment | null> {
  const { rows } = await x.query<Row>(
    `UPDATE payments
        SET status = $2::text,
            confirmations = $3,
            confirmed_at = CASE WHEN $2::text = 'confirmed' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END
      WHERE id = $1
      RETURNING *`,
    [id, status, confirmations]
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function transitionDetectedPayment(
  id: string,
  status: PaymentStatus,
  confirmations: number,
  x: Executor = db()
): Promise<Payment | null> {
  const { rows } = await x.query<Row>(
    `UPDATE payments
        SET status = $2::text,
            confirmations = $3,
            confirmed_at = CASE WHEN $2::text = 'confirmed' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END
      WHERE id = $1 AND status = 'detected'
      RETURNING *`,
    [id, status, confirmations]
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function paymentsAwaitingConfirmation(x: Executor = db()): Promise<
  Array<Payment & { merchantId: string; amountExpected: string }>
> {
  const { rows } = await x.query<
    Row & { merchant_id: string; amount_expected: string }
  >(
    `SELECT p.*, i.merchant_id, i.amount_expected
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE p.status = 'detected'`
  );
  return rows.map((r) => ({
    ...toPayment(r),
    merchantId: r.merchant_id,
    amountExpected: r.amount_expected
  }));
}

export async function onChainTotalNgn(x: Executor = db()): Promise<string> {
  const { rows } = await x.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(s.amount_ngn), 0)::text AS total
       FROM payments p JOIN settlements s ON s.payment_id = p.id
      WHERE p.status = 'confirmed'`
  );
  return rows[0]?.total ?? "0";
}
