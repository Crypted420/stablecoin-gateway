import type { DomainEvent } from "@gateway/core";
import type { Broker, Delivery } from "./types.js";

interface Entry {
  id: string;
  event: DomainEvent;
}

export class MemoryBroker implements Broker {
  private readonly entries: Entry[] = [];
  private readonly cursors = new Map<string, number>();
  private readonly pending = new Map<string, Map<string, { at: number; delivery: Delivery }>>();
  readonly deadLettered: Array<{ group: string; event: DomainEvent; error: string }> = [];
  private readonly attempts = new Map<string, number>();
  private sequence = 0;

  async publish(event: DomainEvent): Promise<string> {
    this.sequence += 1;
    const id = `${this.sequence}-0`;
    this.entries.push({ id, event });
    return id;
  }

  async ensureGroup(group: string): Promise<void> {
    if (!this.cursors.has(group)) this.cursors.set(group, 0);
    if (!this.pending.has(group)) this.pending.set(group, new Map());
  }

  async read(group: string, _consumer: string, count: number): Promise<Delivery[]> {
    await this.ensureGroup(group);
    const cursor = this.cursors.get(group) ?? 0;
    const slice = this.entries.slice(cursor, cursor + count);
    this.cursors.set(group, cursor + slice.length);
    const pending = this.pending.get(group)!;
    const deliveries = slice.map((e) => ({ id: e.id, event: e.event }));
    for (const d of deliveries) pending.set(d.id, { at: Date.now(), delivery: d });
    return deliveries;
  }

  async reclaim(group: string, _consumer: string, minIdleMs: number, count: number): Promise<Delivery[]> {
    await this.ensureGroup(group);
    const pending = this.pending.get(group)!;
    const now = Date.now();
    const out: Delivery[] = [];
    for (const [, value] of pending) {
      if (out.length >= count) break;
      if (now - value.at >= minIdleMs) {
        value.at = now;
        out.push(value.delivery);
      }
    }
    return out;
  }

  async ack(group: string, id: string): Promise<void> {
    this.pending.get(group)?.delete(id);
  }

  async deadLetter(group: string, delivery: Delivery, error: string): Promise<void> {
    this.deadLettered.push({ group, event: delivery.event, error });
    await this.ack(group, delivery.id);
  }

  async pendingCount(group: string): Promise<number> {
    return this.pending.get(group)?.size ?? 0;
  }

  async incrementAttempt(group: string, id: string): Promise<number> {
    const key = `${group}:${id}`;
    const value = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, value);
    return value;
  }

  async clearAttempt(group: string, id: string): Promise<void> {
    this.attempts.delete(`${group}:${id}`);
  }

  async close(): Promise<void> {}

  redeliver(group: string, id: string): Delivery | undefined {
    return this.pending.get(group)?.get(id)?.delivery;
  }

  size(): number {
    return this.entries.length;
  }
}
