import { Redis } from "ioredis";
import { config, parseEvent, type DomainEvent } from "@gateway/core";
import { DLQ_STREAM, STREAM, type Broker, type Delivery } from "./types.js";

function decode(entries: Array<[string, string[]]>): Delivery[] {
  const out: Delivery[] = [];
  for (const [id, fields] of entries) {
    const index = fields.indexOf("payload");
    if (index === -1) continue;
    const raw = fields[index + 1];
    if (!raw) continue;
    out.push({ id, event: parseEvent(JSON.parse(raw)) });
  }
  return out;
}

export class RedisBroker implements Broker {
  private readonly redis: Redis;
  private readonly readers = new Map<string, Redis>();
  private readonly groups = new Set<string>();

  constructor(url = config().REDIS_URL) {
    this.redis = new Redis(url, { maxRetriesPerRequest: null });
  }

  async publish(event: DomainEvent): Promise<string> {
    const id = await this.redis.xadd(STREAM, "*", "payload", JSON.stringify(event));
    return id ?? "";
  }

  async ensureGroup(group: string): Promise<void> {
    if (this.groups.has(group)) return;
    try {
      await this.redis.xgroup("CREATE", STREAM, group, "0", "MKSTREAM");
    } catch (error) {
      if (!String(error).includes("BUSYGROUP")) throw error;
    }
    this.groups.add(group);
  }

  async read(group: string, consumer: string, count: number, blockMs: number): Promise<Delivery[]> {
    await this.ensureGroup(group);
    const readerKey = `${group}:${consumer}`;
    let reader = this.readers.get(readerKey);
    if (!reader) {
      // Blocking XREADGROUP commands must not share the command connection.
      // Otherwise health checks, publishing and the other consumer groups all
      // queue behind each consumer's BLOCK timeout.
      reader = this.redis.duplicate();
      this.readers.set(readerKey, reader);
    }
    const result = (await reader.xreadgroup(
      "GROUP",
      group,
      consumer,
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      STREAM,
      ">"
    )) as Array<[string, Array<[string, string[]]>]> | null;
    if (!result) return [];
    return result.flatMap(([, entries]) => decode(entries));
  }

  async reclaim(group: string, consumer: string, minIdleMs: number, count: number): Promise<Delivery[]> {
    await this.ensureGroup(group);
    const result = (await this.redis.xautoclaim(
      STREAM,
      group,
      consumer,
      minIdleMs,
      "0",
      "COUNT",
      count
    )) as [string, Array<[string, string[]]>, string[]];
    return decode(result[1] ?? []);
  }

  async ack(group: string, id: string): Promise<void> {
    await this.redis.xack(STREAM, group, id);
  }

  async deadLetter(group: string, delivery: Delivery, error: string): Promise<void> {
    await this.redis.xadd(
      DLQ_STREAM,
      "*",
      "payload",
      JSON.stringify(delivery.event),
      "group",
      group,
      "error",
      error
    );
    await this.ack(group, delivery.id);
  }

  async pendingCount(group: string): Promise<number> {
    await this.ensureGroup(group);
    const summary = (await this.redis.xpending(STREAM, group)) as [number, ...unknown[]] | null;
    return summary ? Number(summary[0] ?? 0) : 0;
  }

  async incrementAttempt(group: string, id: string): Promise<number> {
    return this.redis.hincrby(`${STREAM}.attempts.${group}`, id, 1);
  }

  async clearAttempt(group: string, id: string): Promise<void> {
    await this.redis.hdel(`${STREAM}.attempts.${group}`, id);
  }

  async close(): Promise<void> {
    await Promise.all([...this.readers.values()].map((reader) => reader.quit()));
    this.readers.clear();
    await this.redis.quit();
  }
}
