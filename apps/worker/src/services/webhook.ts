import { createLogger, type DomainEvent } from "@gateway/core";
import { invoices, merchants, webhooks } from "@gateway/db";
import { WebhookDispatcher } from "@gateway/providers";

const log = createLogger("webhook");

export class WebhookService {
  constructor(private readonly dispatcher = new WebhookDispatcher()) {}

  async handle(event: DomainEvent): Promise<void> {
    const merchantId = await this.merchantIdFor(event);
    if (!merchantId) return;
    const merchant = await merchants.findMerchantById(merchantId);
    if (!merchant?.webhookUrl) return;

    const claimed = await webhooks.beginDelivery(event.eventId, merchantId, merchant.webhookUrl);
    if (!claimed) return;
    try {
      const status = await this.dispatcher.deliver(merchant.webhookUrl, event);
      await webhooks.markDelivered(event.eventId, status);
      log.info("webhook delivered", { eventId: event.eventId, merchantId, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await webhooks.markFailed(event.eventId, message);
      throw error;
    }
  }

  async markDeadLettered(event: DomainEvent, error: string): Promise<void> {
    await webhooks.markDeadLettered(event.eventId, error);
  }

  private async merchantIdFor(event: DomainEvent): Promise<string | null> {
    if ("merchantId" in event) return event.merchantId;
    if (event.name === "PaymentDetected" || event.name === "PaymentRejected") {
      const invoice = await invoices.findInvoiceById(event.invoiceId);
      return invoice?.merchantId ?? null;
    }
    return null;
  }
}
