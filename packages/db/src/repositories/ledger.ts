import { AppError, type LedgerDirection, type LedgerEntry, ngn } from "@gateway/core";
import { db, type Executor } from "../pool.js";

export interface EntryInput {
  account: string;
  direction: LedgerDirection;
  amount: string;
  currency: string;
}

interface Row {
  id: string;
  settlement_id: string;
  account: string;
  direction: string;
  amount: string;
  currency: string;
  created_at: Date;
}

const toEntry = (r: Row): LedgerEntry => ({
  id: r.id,
  settlementId: r.settlement_id,
  account: r.account,
  direction: r.direction as LedgerDirection,
  amount: r.amount,
  currency: r.currency,
  createdAt: r.created_at.toISOString()
});

export function assertBalanced(entries: EntryInput[]): void {
  if (entries.length < 2) {
    throw new AppError("A journal needs at least one debit and one credit", 500, "unbalanced_journal");
  }
  let debits = ngn("0.00");
  let credits = ngn("0.00");
  for (const entry of entries) {
    const amount = ngn(entry.amount);
    if (entry.direction === "debit") debits = debits.add(amount);
    else credits = credits.add(amount);
  }
  if (debits.compare(credits) !== 0) {
    throw new AppError(
      `Journal does not balance: debits ${debits.toString()} against credits ${credits.toString()}`,
      500,
      "unbalanced_journal"
    );
  }
}

export async function journal(
  settlementId: string,
  journalKey: string,
  entries: EntryInput[],
  x: Executor = db()
): Promise<LedgerEntry[]> {
  assertBalanced(entries);
  const written: LedgerEntry[] = [];
  for (const entry of entries) {
    const { rows } = await x.query<Row>(
      `INSERT INTO ledger_entries (settlement_id, journal_key, account, direction, amount, currency)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [settlementId, journalKey, entry.account, entry.direction, entry.amount, entry.currency]
    );
    written.push(toEntry(rows[0]!));
  }
  return written;
}

export async function entriesForSettlement(
  settlementId: string,
  x: Executor = db()
): Promise<LedgerEntry[]> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM ledger_entries WHERE settlement_id = $1 ORDER BY created_at",
    [settlementId]
  );
  return rows.map(toEntry);
}

export async function entriesForMerchantSettlement(
  merchantId: string,
  settlementId: string,
  x: Executor = db()
): Promise<LedgerEntry[] | null> {
  const { rows } = await x.query<Row>(
    `SELECT le.*
       FROM ledger_entries le
       JOIN settlements s ON s.id = le.settlement_id
       JOIN payments p ON p.id = s.payment_id
       JOIN invoices i ON i.id = p.invoice_id
      WHERE le.settlement_id = $1 AND i.merchant_id = $2
      ORDER BY le.created_at`,
    [settlementId, merchantId]
  );
  if (rows.length > 0) return rows.map(toEntry);
  const owned = await x.query(
    `SELECT 1
       FROM settlements s
       JOIN payments p ON p.id = s.payment_id
       JOIN invoices i ON i.id = p.invoice_id
      WHERE s.id = $1 AND i.merchant_id = $2`,
    [settlementId, merchantId]
  );
  return owned.rowCount ? [] : null;
}

export async function ledgerTotals(x: Executor = db()): Promise<{ debit: string; credit: string }> {
  const { rows } = await x.query<{ direction: string; total: string }>(
    "SELECT direction, COALESCE(SUM(amount), 0)::text AS total FROM ledger_entries GROUP BY direction"
  );
  const find = (d: string) => rows.find((r) => r.direction === d)?.total ?? "0";
  return { debit: find("debit"), credit: find("credit") };
}

export async function hasEntries(settlementId: string, x: Executor = db()): Promise<boolean> {
  const { rows } = await x.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM ledger_entries WHERE settlement_id = $1",
    [settlementId]
  );
  return Number(rows[0]?.n ?? "0") > 0;
}
