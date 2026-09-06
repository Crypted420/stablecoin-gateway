import type { Invoice, InvoiceStatus, Network, Token } from "@gateway/core";
import { db, type Executor } from "../pool.js";

interface Row {
  id: string;
  merchant_id: string;
  reference: string;
  amount_expected: string;
  token_symbol: string;
  network: string;
  deposit_address: string;
  derivation_index: number;
  status: string;
  expires_at: Date;
  created_at: Date;
}

const toInvoice = (r: Row): Invoice => ({
  id: r.id,
  merchantId: r.merchant_id,
  reference: r.reference,
  amountExpected: r.amount_expected,
  tokenSymbol: r.token_symbol as Token,
  network: r.network as Network,
  depositAddress: r.deposit_address,
  derivationIndex: r.derivation_index,
  status: r.status as InvoiceStatus,
  expiresAt: r.expires_at.toISOString(),
  createdAt: r.created_at.toISOString()
});

export async function nextDerivationIndex(x: Executor = db()): Promise<number> {
  const { rows } = await x.query<{ next: string }>(
    "SELECT nextval('invoice_derivation_seq')::text AS next"
  );
  return Number(rows[0]?.next ?? 0);
}

export async function insertInvoice(
  input: {
    merchantId: string;
    reference: string;
    amountExpected: string;
    tokenSymbol: Token;
    network: Network;
    depositAddress: string;
    derivationIndex: number;
    expiresAt: Date;
  },
  x: Executor = db()
): Promise<Invoice> {
  const { rows } = await x.query<Row>(
    `INSERT INTO invoices
       (merchant_id, reference, amount_expected, token_symbol, network, deposit_address, derivation_index, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.merchantId,
      input.reference,
      input.amountExpected,
      input.tokenSymbol,
      input.network,
      input.depositAddress,
      input.derivationIndex,
      input.expiresAt
    ]
  );
  return toInvoice(rows[0]!);
}

export async function findInvoiceById(id: string, x: Executor = db()): Promise<Invoice | null> {
  const { rows } = await x.query<Row>("SELECT * FROM invoices WHERE id = $1", [id]);
  return rows[0] ? toInvoice(rows[0]) : null;
}

export async function findInvoiceByDepositAddress(
  address: string,
  network: Network,
  x: Executor = db()
): Promise<Invoice | null> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM invoices WHERE lower(deposit_address) = lower($1) AND network = $2",
    [address, network]
  );
  return rows[0] ? toInvoice(rows[0]) : null;
}

export async function listInvoices(
  merchantId: string,
  limit = 50,
  x: Executor = db()
): Promise<Invoice[]> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM invoices WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2",
    [merchantId, limit]
  );
  return rows.map(toInvoice);
}

export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  x: Executor = db()
): Promise<void> {
  await x.query("UPDATE invoices SET status = $2 WHERE id = $1", [id, status]);
}

export async function expireStaleInvoices(x: Executor = db()): Promise<number> {
  const { rowCount } = await x.query(
    "UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at < now()"
  );
  return rowCount ?? 0;
}

export async function activeDepositAddresses(
  x: Executor = db()
): Promise<Array<{ address: string; network: Network; invoiceId: string; tokenSymbol: Token }>> {
  const { rows } = await x.query<{
    deposit_address: string;
    network: string;
    id: string;
    token_symbol: string;
  }>(
    `SELECT i.id, i.deposit_address, i.network, i.token_symbol
       FROM invoices i
      WHERE i.status = 'pending'
         OR (i.status = 'detected' AND EXISTS (
              SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.status = 'detected'
            ))`
  );
  return rows.map((r) => ({
    address: r.deposit_address,
    network: r.network as Network,
    invoiceId: r.id,
    tokenSymbol: r.token_symbol as Token
  }));
}
