import { createLogger, type DomainEvent } from "@gateway/core";
import { events, ledger, withTransaction } from "@gateway/db";

const log = createLogger("ledger");

export const ACCOUNTS = {
  cryptoReceivable: "crypto_receivable",
  merchantPayable: "merchant_payable",
  settlementFloat: "settlement_float"
} as const;

export class LedgerService {
  async handle(event: DomainEvent): Promise<void> {
    if (event.name === "QuoteLocked") {
      await this.write(event, [
        {
          account: ACCOUNTS.cryptoReceivable,
          direction: "debit",
          amount: event.amountNgn,
          currency: "NGN"
        },
        {
          account: ACCOUNTS.merchantPayable,
          direction: "credit",
          amount: event.amountNgn,
          currency: "NGN"
        }
      ]);
      return;
    }

    if (event.name === "SettlementCompleted") {
      await this.write(event, [
        {
          account: ACCOUNTS.merchantPayable,
          direction: "debit",
          amount: event.amountNgn,
          currency: "NGN"
        },
        {
          account: ACCOUNTS.settlementFloat,
          direction: "credit",
          amount: event.amountNgn,
          currency: "NGN"
        }
      ]);
    }
  }

  private async write(
    event: Extract<DomainEvent, { name: "QuoteLocked" | "SettlementCompleted" }>,
    entries: Array<{ account: string; direction: "debit" | "credit"; amount: string; currency: string }>
  ): Promise<void> {
    await withTransaction(async (client) => {
      const journalKey = `${event.settlementId}:${event.name}`;
      const claimed = await events.claimEvent(journalKey, "ledger", client);
      if (!claimed) return;
      await ledger.journal(event.settlementId, journalKey, entries, client);
    });
    log.info("journalled", { settlementId: event.settlementId, event: event.name, entries: entries.length });
  }
}
