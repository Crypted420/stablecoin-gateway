import type { AxiosInstance } from "axios";
import { AppError, config, createLogger } from "@gateway/core";
import { httpClient } from "./http.js";

export interface Bank {
  name: string;
  code: string;
  slug: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
}

export class AccountResolutionError extends AppError {
  constructor(message = "That account could not be resolved at the bank") {
    super(message, 422, "account_unresolved");
  }
}

export interface BankDirectory {
  listBanks(): Promise<Bank[]>;
  resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount>;
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

export class PaystackBankDirectory implements BankDirectory {
  private readonly log = createLogger("banks-paystack");
  private readonly http: AxiosInstance;
  private cache: { banks: Bank[]; at: number } | null = null;

  constructor(secretKey = config().PAYSTACK_SECRET_KEY, http?: AxiosInstance) {
    if (!http && !secretKey) {
      throw new AppError("PAYSTACK_SECRET_KEY is not set", 500, "banks_unconfigured");
    }
    this.http =
      http ??
      httpClient({
        baseURL: "https://api.paystack.co",
        headers: { Authorization: `Bearer ${secretKey}` }
      });
  }

  async listBanks(): Promise<Bank[]> {
    if (this.cache && Date.now() - this.cache.at < 3_600_000) return this.cache.banks;

    const perPage = 100;
    const seen = new Map<string, Bank>();

    for (let page = 1; page <= 10; page += 1) {
      const { status, data: body } = await this.http.get<
        PaystackEnvelope<Array<{ name?: string; code?: string; slug?: string }>>
      >("/bank", { params: { currency: "NGN", perPage, page, use_cursor: false } });

      if (status >= 400 || !body?.status || !body.data) {
        if (seen.size > 0) break;
        throw new AppError(body?.message ?? "Could not read the bank list", 502, "banks_unavailable");
      }

      for (const entry of body.data) {
        if (!entry.name || !entry.code || seen.has(entry.code)) continue;
        seen.set(entry.code, { name: entry.name, code: entry.code, slug: entry.slug ?? entry.code });
      }
      if (body.data.length < perPage) break;
    }

    const banks = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (banks.length === 0) {
      throw new AppError("The bank list came back empty", 502, "banks_unavailable");
    }

    this.cache = { banks, at: Date.now() };
    this.log.debug("bank directory refreshed", { count: banks.length });
    return banks;
  }

  async resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
    const { status, data: body } = await this.http.get<
      PaystackEnvelope<{ account_number?: string; account_name?: string }>
    >("/bank/resolve", { params: { account_number: accountNumber, bank_code: bankCode } });

    if (status >= 400 || !body?.status || !body.data?.account_name) {
      throw new AccountResolutionError(body?.message ?? undefined);
    }

    const banks = await this.listBanks().catch(() => [] as Bank[]);
    return {
      accountNumber: body.data.account_number ?? accountNumber,
      accountName: body.data.account_name,
      bankCode,
      bankName: banks.find((bank) => bank.code === bankCode)?.name ?? bankCode
    };
  }
}

export function createBankDirectory(): BankDirectory {
  return new PaystackBankDirectory();
}
