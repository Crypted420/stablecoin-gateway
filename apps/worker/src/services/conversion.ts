import {
  convertToNgn,
  createLogger,
  metrics,
  newEnvelope,
  tokenAmountToDecimal,
  type DomainEvent,
  type PaymentConfirmed
} from "@gateway/core";
import type { FxProvider } from "@gateway/providers";
import { outbox, settlements, withTransaction } from "@gateway/db";

const log = createLogger("conversion");

export class ConversionService {
  constructor(
    private readonly fx: FxProvider
  ) {}

  async handleConfirmed(event: PaymentConfirmed): Promise<void> {
    const cryptoAmount = tokenAmountToDecimal(event.amountRaw, event.network, event.tokenSymbol).toString();
    const quote = await this.fx.quote(event.tokenSymbol, event.network, cryptoAmount);
    const amountNgn = convertToNgn(event.amountRaw, event.network, event.tokenSymbol, quote.rate);
    const rate = quote.rate;

    let settlement = null as Awaited<ReturnType<typeof settlements.insertSettlementIfNew>>;
    await withTransaction(async (client) => {
      settlement = await settlements.insertSettlementIfNew(
        {
          paymentId: event.paymentId,
          quoteRate: rate,
          amountNgn,
          valuationBasis: event.tokenSymbol === "cNGN" ? "par" : "market"
        },
        client
      );
      if (!settlement) return;
      await outbox.enqueue(
        {
          ...newEnvelope(event.correlationId),
          name: "QuoteLocked",
          settlementId: settlement.id,
          paymentId: event.paymentId,
          merchantId: event.merchantId,
          rate: quote.rate,
          amountNgn
        } satisfies DomainEvent,
        client
      );
    });

    if (!settlement) {
      metrics.increment("duplicate_events_discarded_total", { consumer: "conversion" });
      log.debug("settlement already exists for payment", { paymentId: event.paymentId });
      return;
    }

    metrics.increment("quotes_locked_total", { token: event.tokenSymbol });
    log.info("quote locked", { settlementId: settlement.id, rate: quote.rate, amountNgn });
  }
}
