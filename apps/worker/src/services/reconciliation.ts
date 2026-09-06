import { createLogger, metrics, ngn, type ReconciliationReport } from "@gateway/core";
import type { ChainSource } from "@gateway/chain";
import { ledger, reconciliation } from "@gateway/db";

const log = createLogger("reconciliation");

export class ReconciliationService {
  constructor(private readonly source: ChainSource) {}

  async run(periodStart: Date, periodEnd: Date): Promise<ReconciliationReport> {
    const items = await reconciliation.itemsInPeriod(periodStart, periodEnd);
    let onChain = ngn("0.00");
    let ledgerDebits = ngn("0.00");
    let ledgerCredits = ngn("0.00");
    let payouts = ngn("0.00");
    let outstanding = ngn("0.00");
    let checkedPayments = 0;
    let checkedPayouts = 0;
    const discrepancies: string[] = [];

    for (const item of items) {
      const amount = ngn(item.amountNgn);
      const canonical = await this.source.isCanonical(item.network, item.blockNumber, item.blockHash);
      checkedPayments += 1;
      if (canonical) onChain = onChain.add(amount);
      else discrepancies.push(`Payment ${item.paymentId} is no longer in the canonical ${item.network} chain`);

      const entries = await ledger.entriesForSettlement(item.settlementId);
      for (const entry of entries) {
        const value = ngn(entry.amount);
        if (entry.direction === "debit") ledgerDebits = ledgerDebits.add(value);
        else ledgerCredits = ledgerCredits.add(value);
      }
      this.validateJournal(item.settlementId, item.amountNgn, item.status === "completed", entries, discrepancies);

      if (item.status === "completed") {
        checkedPayouts += 1;
        if (item.providerReference && item.providerStatus === "success") {
          payouts = payouts.add(amount);
        } else {
          discrepancies.push(`Payout ${item.settlementId} lacks stored successful provider evidence`);
        }
      } else {
        outstanding = outstanding.add(amount);
      }
    }

    if (ledgerDebits.compare(ledgerCredits) !== 0) {
      discrepancies.push(`Ledger debits ${ledgerDebits.toString()} do not equal credits ${ledgerCredits.toString()}`);
    }
    if (onChain.compare(payouts.add(outstanding)) !== 0) {
      discrepancies.push(
        `Canonical inflows ${onChain.toString()} do not equal paid plus outstanding liabilities ${payouts.add(outstanding).toString()}`
      );
    }

    const report: ReconciliationReport = {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      onChainTotalNgn: onChain.toString(),
      ledgerDebitTotal: ledgerDebits.toString(),
      ledgerCreditTotal: ledgerCredits.toString(),
      payoutTotalNgn: payouts.toString(),
      outstandingPayoutNgn: outstanding.toString(),
      balanced: discrepancies.length === 0,
      discrepancies,
      checkedPayments,
      checkedPayouts
    };
    await reconciliation.save(report);
    metrics.increment("reconciliation_runs_total", { balanced: String(report.balanced) });
    if (!report.balanced) log.error("reconciliation did not balance", { discrepancies });
    return report;
  }

  private validateJournal(
    settlementId: string,
    amount: string,
    completed: boolean,
    entries: Awaited<ReturnType<typeof ledger.entriesForSettlement>>,
    discrepancies: string[]
  ): void {
    const expected = [
      `crypto_receivable:debit:${amount}`,
      `merchant_payable:credit:${amount}`,
      ...(completed ? [`merchant_payable:debit:${amount}`, `settlement_float:credit:${amount}`] : [])
    ].sort();
    const actual = entries.map((entry) => `${entry.account}:${entry.direction}:${entry.amount}`).sort();
    if (expected.join("|") !== actual.join("|")) {
      discrepancies.push(`Settlement ${settlementId} has incomplete or duplicate ledger entries`);
    }
  }
}
