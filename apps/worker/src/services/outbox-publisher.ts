import { createLogger, metrics } from "@gateway/core";
import type { Broker } from "@gateway/broker";
import { outbox } from "@gateway/db";

const log = createLogger("outbox-publisher");

export class OutboxPublisher {
  private running = false;
  private readonly workerId = `outbox-${process.pid}-${crypto.randomUUID()}`;

  constructor(private readonly broker: Broker) {}

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      const processed = await this.tick().catch((error) => {
        log.error("outbox sweep failed", { error: String(error) });
        return 0;
      });
      if (processed === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async tick(): Promise<number> {
    const records = await outbox.claimBatch(this.workerId);
    for (const record of records) {
      try {
        await this.broker.publish(record.event);
        await outbox.markPublished(record.id, this.workerId);
        metrics.increment("outbox_events_published_total", { event: record.event.name });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await outbox.release(record.id, this.workerId, message, record.attempts);
        metrics.increment("outbox_events_failed_total", { event: record.event.name });
      }
    }
    return records.length;
  }

  stop(): void {
    this.running = false;
  }
}
