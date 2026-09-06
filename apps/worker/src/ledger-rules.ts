import { AppError, ngn, type LedgerDirection } from "@gateway/core";

export interface JournalLine {
  direction: LedgerDirection;
  amount: string;
}

export function assertBalancedEntries(lines: JournalLine[]): void {
  if (lines.length < 2) {
    throw new AppError("A journal needs at least one debit and one credit", 500, "unbalanced_journal");
  }
  let debits = ngn("0.00");
  let credits = ngn("0.00");
  for (const line of lines) {
    const amount = ngn(line.amount);
    if (line.direction === "debit") debits = debits.add(amount);
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
