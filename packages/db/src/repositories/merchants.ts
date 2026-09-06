import type { Merchant } from "@gateway/core";
import { db, type Executor } from "../pool.js";

interface Row {
  id: string;
  account_name: string;
  bank_account_number: string;
  bank_name: string;
  bank_code: string;
  account_verified: boolean;
  webhook_url: string | null;
  status: string;
  created_at: Date;
}

const toMerchant = (r: Row): Merchant => ({
  id: r.id,
  accountName: r.account_name,
  bankAccountNumber: r.bank_account_number,
  bankName: r.bank_name,
  bankCode: r.bank_code,
  accountVerified: r.account_verified,
  webhookUrl: r.webhook_url,
  status: r.status as Merchant["status"],
  createdAt: r.created_at.toISOString()
});

export interface MerchantInput {
  accountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankCode: string;
  accountVerified?: boolean;
  webhookUrl?: string | null;
}

export async function upsertMerchant(input: MerchantInput, x: Executor = db()): Promise<Merchant> {
  const { rows } = await x.query<Row>(
    `INSERT INTO merchants (account_name, bank_account_number, bank_name, bank_code, account_verified, webhook_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (bank_account_number, bank_code)
     DO UPDATE SET account_name     = EXCLUDED.account_name,
                   bank_name        = EXCLUDED.bank_name,
                   account_verified = merchants.account_verified OR EXCLUDED.account_verified,
                   webhook_url      = COALESCE(EXCLUDED.webhook_url, merchants.webhook_url)
     RETURNING *`,
    [
      input.accountName,
      input.bankAccountNumber,
      input.bankName,
      input.bankCode,
      input.accountVerified ?? false,
      input.webhookUrl ?? null
    ]
  );
  return toMerchant(rows[0]!);
}

export async function findMerchantByBankAccount(
  bankAccountNumber: string,
  bankCode: string,
  x: Executor = db()
): Promise<Merchant | null> {
  const { rows } = await x.query<Row>(
    "SELECT * FROM merchants WHERE bank_account_number = $1 AND bank_code = $2",
    [bankAccountNumber, bankCode]
  );
  return rows[0] ? toMerchant(rows[0]) : null;
}

export async function findMerchantById(id: string, x: Executor = db()): Promise<Merchant | null> {
  const { rows } = await x.query<Row>("SELECT * FROM merchants WHERE id = $1", [id]);
  return rows[0] ? toMerchant(rows[0]) : null;
}

export async function updateWebhookUrl(
  id: string,
  url: string | null,
  x: Executor = db()
): Promise<Merchant | null> {
  const { rows } = await x.query<Row>("UPDATE merchants SET webhook_url = $2 WHERE id = $1 RETURNING *", [
    id,
    url
  ]);
  return rows[0] ? toMerchant(rows[0]) : null;
}
