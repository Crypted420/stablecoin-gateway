import {
  Decimal,
  confirmationDepth,
  createLogger,
  metrics,
  newEnvelope,
  tokenDecimals,
  type DomainEvent,
  type PaymentDetected
} from "@gateway/core";
import type { ChainSource } from "@gateway/chain";
import { invoices, outbox, payments, withTransaction } from "@gateway/db";

const log = createLogger("confirmation");

export class ConfirmationService {
  constructor(
    private readonly source: ChainSource
  ) {}

  async handleDetected(event: PaymentDetected): Promise<void> {
    const payment = await payments.insertPaymentIfNew({
      invoiceId: event.invoiceId,
      txHash: event.txHash,
      logIndex: event.logIndex,
      fromAddress: event.fromAddress,
      amountRaw: event.amountRaw,
      network: event.network,
      tokenSymbol: event.tokenSymbol,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash ?? null
    });

    if (!payment) {
      metrics.increment("duplicate_events_discarded_total", { consumer: "confirmation" });
      log.debug("duplicate transfer discarded", { txHash: event.txHash, logIndex: event.logIndex });
      return;
    }
    log.debug("payment recorded", { paymentId: payment.id });
  }

  async sweep(): Promise<number> {
    const pending = await payments.paymentsAwaitingConfirmation();
    let promoted = 0;
    const chainHeads = new Map<string, number>();

    for (const payment of pending) {
      let chainHead = chainHeads.get(payment.network);
      if (chainHead === undefined) {
        const seedConfirmations = await this.source.confirmationsFor(
          payment.network,
          payment.blockNumber
        );
        chainHead = payment.blockNumber + seedConfirmations - 1;
        chainHeads.set(payment.network, chainHead);
      }
      const confirmations = Math.max(0, chainHead - payment.blockNumber + 1);
      const required = confirmationDepth(payment.network);
      if (confirmations < required) {
        await payments.setPaymentStatus(payment.id, "detected", confirmations);
        continue;
      }

      const canonical = await this.source.isCanonical(payment.network, payment.blockNumber, payment.blockHash);
      if (!canonical) {
        const event = {
          ...newEnvelope(),
          name: "PaymentRejected",
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          reason: "orphaned"
        } satisfies DomainEvent;
        await withTransaction(async (client) => {
          const transitioned = await payments.transitionDetectedPayment(payment.id, "orphaned", confirmations, client);
          if (!transitioned) return;
          await invoices.updateInvoiceStatus(payment.invoiceId, "orphaned", client);
          await outbox.enqueue(event, client);
        });
        metrics.increment("payments_rejected_total", { reason: "orphaned" });
        continue;
      }

      const decimals = tokenDecimals(payment.network, payment.tokenSymbol);
      const received = Decimal.fromUnits(BigInt(payment.amountRaw), decimals);
      const expected = Decimal.fromString(payment.amountExpected, 8).rescale(decimals);
      const comparison = received.compare(expected);

      if (comparison !== 0) {
        const status = comparison < 0 ? "underpaid" : "overpaid";
        const event = {
          ...newEnvelope(),
          name: "PaymentRejected",
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          reason: status
        } satisfies DomainEvent;
        await withTransaction(async (client) => {
          const transitioned = await payments.transitionDetectedPayment(payment.id, status, confirmations, client);
          if (!transitioned) return;
          await invoices.updateInvoiceStatus(payment.invoiceId, status, client);
          await outbox.enqueue(event, client);
        });
        metrics.increment("payments_rejected_total", { reason: status });
        log.warn("amount does not match invoice", {
          paymentId: payment.id,
          received: received.toString(),
          expected: expected.toString()
        });
        continue;
      }

      const event = {
        ...newEnvelope(),
        name: "PaymentConfirmed",
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        merchantId: payment.merchantId,
        amountRaw: payment.amountRaw,
        tokenSymbol: payment.tokenSymbol,
        network: payment.network,
        confirmations
      } satisfies DomainEvent;
      let confirmed = false;
      await withTransaction(async (client) => {
        const transitioned = await payments.transitionDetectedPayment(
          payment.id,
          "confirmed",
          confirmations,
          client
        );
        if (!transitioned) return;
        await invoices.updateInvoiceStatus(payment.invoiceId, "confirmed", client);
        await outbox.enqueue(event, client);
        confirmed = true;
      });
      if (!confirmed) continue;

      metrics.increment("payments_confirmed_total", { network: payment.network });
      metrics.observe("confirmation_latency_ms", Date.now() - new Date(payment.detectedAt).getTime(), {
        network: payment.network
      });
      promoted += 1;
    }

    return promoted;
  }
}
