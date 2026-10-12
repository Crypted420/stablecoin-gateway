import { parseEvent, type DomainEvent } from "@gateway/core";
import { db, type Executor } from "@gateway/db";
import type { Broker, Delivery } from "./types.js";

interface EventRow { event_id: string; payload: unknown }
const decode = (rows: EventRow[]): Delivery[] =>
  rows.map((row) => ({ id: row.event_id, event: parseEvent(row.payload) }));

/** Durable delivery state for hosts without persistent Redis storage. */
export class PostgresBroker implements Broker {
  constructor(private readonly executor: Executor = db()) {}

  async publish(event: DomainEvent): Promise<string> {
    await this.executor.query(
      `INSERT INTO broker_events (event_id, payload) VALUES ($1, $2::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, JSON.stringify(event)]
    );
    return event.eventId;
  }

  async ensureGroup(_group: string): Promise<void> {
    // Groups are represented by their durable delivery rows.
  }

  async read(group: string, consumer: string, count: number, blockMs: number): Promise<Delivery[]> {
    const claim = async () => {
      const { rows } = await this.executor.query<EventRow>(
        `WITH claimed AS (
           INSERT INTO broker_deliveries (group_name, event_id, consumer_name)
           SELECT $1, e.event_id, $2 FROM broker_events e
            WHERE NOT EXISTS (
              SELECT 1 FROM broker_deliveries d WHERE d.group_name = $1 AND d.event_id = e.event_id
            )
            ORDER BY e.ordinal LIMIT $3
           ON CONFLICT DO NOTHING RETURNING event_id
         )
         SELECT e.event_id, e.payload FROM broker_events e
         JOIN claimed c USING (event_id) ORDER BY e.ordinal`,
        [group, consumer, count]
      );
      return decode(rows);
    };
    const deliveries = await claim();
    if (deliveries.length || blockMs <= 0) return deliveries;
    await new Promise((resolve) => setTimeout(resolve, blockMs));
    return claim();
  }

  async reclaim(group: string, consumer: string, minIdleMs: number, count: number): Promise<Delivery[]> {
    const { rows } = await this.executor.query<EventRow>(
      `WITH claimed AS (
         UPDATE broker_deliveries d SET consumer_name = $2, locked_at = now()
          WHERE d.group_name = $1 AND d.event_id IN (
            SELECT event_id FROM broker_deliveries
             WHERE group_name = $1 AND acked_at IS NULL
               AND locked_at <= now() - ($3 * interval '1 millisecond')
             ORDER BY locked_at FOR UPDATE SKIP LOCKED LIMIT $4
          ) RETURNING event_id
       )
       SELECT e.event_id, e.payload FROM broker_events e
       JOIN claimed c USING (event_id) ORDER BY e.ordinal`,
      [group, consumer, minIdleMs, count]
    );
    return decode(rows);
  }

  async ack(group: string, id: string): Promise<void> {
    await this.executor.query(
      "UPDATE broker_deliveries SET acked_at = now() WHERE group_name = $1 AND event_id = $2",
      [group, id]
    );
  }

  async pendingCount(group: string): Promise<number> {
    const { rows } = await this.executor.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM broker_deliveries WHERE group_name = $1 AND acked_at IS NULL",
      [group]
    );
    return rows[0]?.count ?? 0;
  }

  async incrementAttempt(group: string, id: string): Promise<number> {
    const { rows } = await this.executor.query<{ attempts: number }>(
      `UPDATE broker_deliveries SET attempts = attempts + 1
       WHERE group_name = $1 AND event_id = $2 RETURNING attempts`,
      [group, id]
    );
    if (!rows[0]) throw new Error("Delivery does not exist");
    return rows[0].attempts;
  }

  async clearAttempt(group: string, id: string): Promise<void> {
    await this.executor.query(
      "UPDATE broker_deliveries SET attempts = 0 WHERE group_name = $1 AND event_id = $2",
      [group, id]
    );
  }

  async deadLetter(group: string, delivery: Delivery, error: string): Promise<void> {
    await this.executor.query(
      `INSERT INTO broker_dead_letters (group_name, event_id, error) VALUES ($1, $2, $3)
       ON CONFLICT (group_name, event_id) DO UPDATE SET error = EXCLUDED.error`,
      [group, delivery.id, error]
    );
    await this.ack(group, delivery.id);
  }

  async close(): Promise<void> {
    // The worker owns and closes the shared PostgreSQL pool.
  }
}
