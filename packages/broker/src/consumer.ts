import { config, createLogger, metrics, type DomainEvent } from "@gateway/core";
import type { Broker, Delivery } from "./types.js";

export interface ConsumerOptions {
  group: string;
  name: string;
  handles: DomainEvent["name"][];
  handle: (event: DomainEvent) => Promise<void>;
  onDeadLetter?: (event: DomainEvent, error: string, attempts: number) => Promise<void>;
  batchSize?: number;
  blockMs?: number;
  reclaimIdleMs?: number;
  backoff?: (attempt: number) => number;
}

export class Consumer {
  private running = false;
  private readonly log;

  constructor(
    private readonly broker: Broker,
    private readonly options: ConsumerOptions
  ) {
    this.log = createLogger(options.name);
  }

  async start(): Promise<void> {
    this.running = true;
    await this.broker.ensureGroup(this.options.group);
    this.log.debug("consumer started", { group: this.options.group });
    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        this.log.error("consumer loop error", { error: String(error) });
        await sleep(500);
      }
    }
  }

  async tick(): Promise<number> {
    const batch = this.options.batchSize ?? 16;
    const reclaimed = await this.broker.reclaim(
      this.options.group,
      this.options.name,
      this.options.reclaimIdleMs ?? 30_000,
      batch
    );
    const fresh = await this.broker.read(
      this.options.group,
      this.options.name,
      batch,
      this.options.blockMs ?? 2000
    );
    const deliveries = [...reclaimed, ...fresh];
    for (const delivery of deliveries) await this.process(delivery);
    return deliveries.length;
  }

  private async process(delivery: Delivery): Promise<void> {
    const { event } = delivery;
    if (!this.options.handles.includes(event.name)) {
      await this.broker.ack(this.options.group, delivery.id);
      return;
    }

    const started = Date.now();
    try {
      await this.options.handle(event);
      await this.broker.ack(this.options.group, delivery.id);
      await this.broker.clearAttempt(this.options.group, delivery.id);
      metrics.increment("events_processed_total", { consumer: this.options.name, event: event.name });
      metrics.observe("event_handle_ms", Date.now() - started, { consumer: this.options.name });
    } catch (error) {
      const attempts = await this.broker.incrementAttempt(this.options.group, delivery.id);
      const message = error instanceof Error ? error.message : String(error);
      metrics.increment("events_failed_total", { consumer: this.options.name, event: event.name });

      if (attempts >= config().DLQ_MAX_ATTEMPTS) {
        this.log.error("dead-lettering event", { event: event.name, attempts, error: message });
        await this.options.onDeadLetter?.(event, message, attempts);
        await this.broker.deadLetter(this.options.group, delivery, message);
        await this.broker.clearAttempt(this.options.group, delivery.id);
        metrics.increment("events_dead_lettered_total", { consumer: this.options.name });
      } else {
        this.log.warn("event failed, will retry", { event: event.name, attempts, error: message });
        await sleep((this.options.backoff ?? backoffMs)(attempts));
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 250);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
