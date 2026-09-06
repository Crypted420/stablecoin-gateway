import type { DomainEvent } from "@gateway/core";

export const STREAM = "gateway.events";
export const DLQ_STREAM = "gateway.events.dlq";

export interface Delivery {
  id: string;
  event: DomainEvent;
}

export interface Broker {
  publish(event: DomainEvent): Promise<string>;
  ensureGroup(group: string): Promise<void>;
  read(group: string, consumer: string, count: number, blockMs: number): Promise<Delivery[]>;
  reclaim(group: string, consumer: string, minIdleMs: number, count: number): Promise<Delivery[]>;
  ack(group: string, id: string): Promise<void>;
  deadLetter(group: string, delivery: Delivery, error: string): Promise<void>;
  pendingCount(group: string): Promise<number>;
  incrementAttempt(group: string, id: string): Promise<number>;
  clearAttempt(group: string, id: string): Promise<void>;
  close(): Promise<void>;
}
