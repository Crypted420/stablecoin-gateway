import type { DomainEvent } from "@gateway/core";
import { db, type Executor } from "../pool.js";

export interface OutboxRecord {
  id: string;
  event: DomainEvent;
  attempts: number;
}

export async function enqueue(event: DomainEvent, x: Executor = db()): Promise<void> {
  await x.query(
    `INSERT INTO outbox_events (event_id, payload)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [event.eventId, JSON.stringify(event)]
  );
}

export async function claimBatch(
  workerId: string,
  limit = 50,
  x: Executor = db()
): Promise<OutboxRecord[]> {
  const { rows } = await x.query<{ id: string; payload: DomainEvent; attempts: number }>(
    `WITH ready AS (
       SELECT id
         FROM outbox_events
        WHERE published_at IS NULL
          AND available_at <= now()
          AND (locked_at IS NULL OR locked_at < now() - interval '60 seconds')
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     )
     UPDATE outbox_events o
        SET locked_at = now(), locked_by = $1, attempts = attempts + 1
       FROM ready
      WHERE o.id = ready.id
      RETURNING o.id, o.payload, o.attempts`,
    [workerId, limit]
  );
  return rows.map((row) => ({ id: row.id, event: row.payload, attempts: row.attempts }));
}

export async function markPublished(id: string, workerId: string, x: Executor = db()): Promise<void> {
  await x.query(
    `UPDATE outbox_events
        SET published_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
      WHERE id = $1 AND locked_by = $2`,
    [id, workerId]
  );
}

export async function release(
  id: string,
  workerId: string,
  error: string,
  attempts: number,
  x: Executor = db()
): Promise<void> {
  const delaySeconds = Math.min(30, 2 ** Math.min(attempts, 5));
  await x.query(
    `UPDATE outbox_events
        SET locked_at = NULL,
            locked_by = NULL,
            last_error = $3,
            available_at = now() + ($4 * interval '1 second')
      WHERE id = $1 AND locked_by = $2`,
    [id, workerId, error, delaySeconds]
  );
}

export async function pendingCount(x: Executor = db()): Promise<number> {
  const { rows } = await x.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM outbox_events WHERE published_at IS NULL"
  );
  return Number(rows[0]?.count ?? "0");
}
