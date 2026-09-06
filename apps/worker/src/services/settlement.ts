import {
  createLogger,
  metrics,
  newEnvelope,
  type DomainEvent,
  type QuoteLocked
} from "@gateway/core";
import { PayoutTimeoutError, type PayoutProvider, type PayoutResult } from "@gateway/providers";
import { invoices, merchants, outbox, payments, settlements, withTransaction } from "@gateway/db";

const log = createLogger("settlement");

interface PayoutContext {
  settlementId: string;
  paymentId: string;
  merchantId: string;
  amountNgn: string;
  correlationId?: string;
}

export class SettlementService {
  constructor(private readonly payout: PayoutProvider) {}

  async handleQuoteLocked(event: QuoteLocked): Promise<void> {
    await this.execute({
      settlementId: event.settlementId,
      paymentId: event.paymentId,
      merchantId: event.merchantId,
      amountNgn: event.amountNgn,
      correlationId: event.correlationId
    });
  }

  async executeById(settlementId: string): Promise<void> {
    const settlement = await settlements.findSettlementById(settlementId);
    if (!settlement) throw new Error(`Settlement ${settlementId} does not exist`);
    if (settlement.status === "completed") return;

    const payment = await payments.findPaymentById(settlement.paymentId);
    if (!payment) throw new Error(`Payment ${settlement.paymentId} does not exist`);
    const invoice = await invoices.findInvoiceById(payment.invoiceId);
    if (!invoice) throw new Error(`Invoice ${payment.invoiceId} does not exist`);

    await this.execute({
      settlementId,
      paymentId: settlement.paymentId,
      merchantId: invoice.merchantId,
      amountNgn: settlement.amountNgn
    });
  }

  async reconcileSubmitted(): Promise<number> {
    const submitted = await settlements.submittedSettlements();
    let completed = 0;
    for (const settlement of submitted) {
      try {
        const payment = await payments.findPaymentById(settlement.paymentId);
        if (!payment) continue;
        const invoice = await invoices.findInvoiceById(payment.invoiceId);
        if (!invoice) continue;
        const result = await this.payout.lookup(settlement.id);
        if (!result) continue;
        const before = settlement.status;
        await this.applyProviderResult(
          {
            settlementId: settlement.id,
            paymentId: payment.id,
            merchantId: invoice.merchantId,
            amountNgn: settlement.amountNgn
          },
          result,
          Date.now(),
          settlement.attempts
        );
        if (before === "submitted" && result.accepted && result.conclusive) completed += 1;
      } catch (error) {
        log.warn("could not reconcile submitted payout", {
          settlementId: settlement.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return completed;
  }

  private async execute(context: PayoutContext): Promise<void> {
    const claimed = await settlements.beginAttempt(context.settlementId);
    if (!claimed) {
      metrics.increment("duplicate_events_discarded_total", { consumer: "settlement" });
      return;
    }

    const merchant = await merchants.findMerchantById(context.merchantId);
    if (!merchant) throw new Error(`Merchant ${context.merchantId} no longer exists`);
    if (merchant.status !== "active") throw new Error(`Merchant ${context.merchantId} is suspended`);

    const request = {
      idempotencyKey: context.settlementId,
      amountNgn: context.amountNgn,
      bankAccountNumber: merchant.bankAccountNumber,
      bankCode: merchant.bankCode,
      reason: "TRF"
    };

    const started = Date.now();
    try {
      const existing = await this.payout.lookup(context.settlementId);
      if (existing) {
        await this.applyProviderResult(context, existing, started, claimed.attempts);
        return;
      }
      const result = await this.payout.transfer(request);
      await this.applyProviderResult(context, result, started, claimed.attempts);
    } catch (error) {
      if (error instanceof PayoutTimeoutError) {
        const resolved = await this.payout.lookup(context.settlementId).catch(() => null);
        if (resolved) {
          await this.applyProviderResult(context, resolved, started, claimed.attempts);
          return;
        }
        await settlements.markSubmitted(context.settlementId, context.settlementId, "unknown");
        log.warn("payout outcome is unknown; awaiting reconciliation", {
          settlementId: context.settlementId
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(context, message, claimed.attempts);
      throw error;
    }
  }

  private async applyProviderResult(
    context: PayoutContext,
    result: PayoutResult,
    started: number,
    attempts: number
  ): Promise<void> {
    if (result.conclusive && result.accepted) {
      await this.complete(context, result.providerReference, started);
      return;
    }
    if (result.conclusive) {
      const status = result.providerStatus ?? "failed";
      const message = `Payout provider reports ${status}`;
      const failed = await settlements.markProviderFailed(
        context.settlementId,
        result.providerReference,
        status,
        message
      );
      if (failed) await this.emitFailure(context, message, attempts);
      log.warn("payout reached a conclusive failure", {
        settlementId: context.settlementId,
        providerStatus: status
      });
      return;
    }
    await settlements.markSubmitted(
      context.settlementId,
      result.providerReference,
      result.providerStatus
    );
    log.info("payout submitted; awaiting Paystack final status", {
      settlementId: context.settlementId,
      providerStatus: result.providerStatus ?? "unknown"
    });
  }

  private async fail(context: PayoutContext, message: string, attempts: number): Promise<void> {
    await withTransaction(async (client) => {
      await settlements.markFailed(context.settlementId, message, false, client);
      await this.enqueueFailure(context, message, attempts, client);
    });
    metrics.increment("settlements_failed_total");
  }

  private async emitFailure(context: PayoutContext, message: string, attempts: number): Promise<void> {
    await withTransaction((client) => this.enqueueFailure(context, message, attempts, client));
    metrics.increment("settlements_failed_total");
  }

  private async enqueueFailure(
    context: PayoutContext,
    message: string,
    attempts: number,
    client: Parameters<typeof settlements.markFailed>[3]
  ): Promise<void> {
    await outbox.enqueue(
      {
        ...newEnvelope(context.correlationId),
        name: "SettlementFailed",
        settlementId: context.settlementId,
        paymentId: context.paymentId,
        merchantId: context.merchantId,
        reason: message,
        attempts
      } satisfies DomainEvent,
      client
    );
  }

  private async complete(
    context: PayoutContext,
    providerReference: string,
    started: number
  ): Promise<void> {
    const payment = await payments.findPaymentById(context.paymentId);
    const completedEvent = {
      ...newEnvelope(context.correlationId),
      name: "SettlementCompleted",
      settlementId: context.settlementId,
      paymentId: context.paymentId,
      merchantId: context.merchantId,
      amountNgn: context.amountNgn,
      providerReference
    } satisfies DomainEvent;

    let completed = false;
    await withTransaction(async (client) => {
      const row = await settlements.markCompleted(context.settlementId, providerReference, client);
      if (!row) return;
      if (payment) await invoices.updateInvoiceStatus(payment.invoiceId, "settled", client);
      await outbox.enqueue(completedEvent, client);
      completed = true;
    });
    if (!completed) return;

    metrics.increment("settlements_completed_total");
    metrics.observe("payout_call_ms", Date.now() - started);

    if (payment) {
      metrics.observe("end_to_end_settlement_ms", Date.now() - new Date(payment.detectedAt).getTime());
    }
    log.info("settlement completed", { settlementId: context.settlementId, providerReference });
  }

  async markDeadLettered(settlementId: string, error: string): Promise<void> {
    await settlements.markFailed(settlementId, error, true);
  }
}
